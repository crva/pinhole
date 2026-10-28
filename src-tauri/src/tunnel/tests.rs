use std::{
    net::{Ipv4Addr, Ipv6Addr},
    time::Duration,
};

use iroh::{RelayMode, SecretKey};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;

fn sample_ticket() -> Ticket {
    let id = SecretKey::from_bytes(&[7u8; 32]).public();
    let relay = "https://relay.example.org./".parse().unwrap();
    Ticket {
        addr: EndpointAddr::new(id)
            .with_relay_url(relay)
            .with_ip_addr("192.168.1.20:4242".parse().unwrap()),
        proto: Proto::Udp,
        port: 25565,
        token: [9u8; TOKEN_LEN],
    }
}

// --- Share code ------------------------------------------------------------

#[test]
fn ticket_roundtrip() {
    let ticket = sample_ticket();
    let code = ticket.encode();
    assert!(code.starts_with(TICKET_PREFIX));
    assert!(code.len() <= MAX_TICKET_LEN);
    assert_eq!(Ticket::decode(&code).unwrap(), ticket);
    // Pasted codes often come with surrounding whitespace.
    assert_eq!(Ticket::decode(&format!("  {code}\n")).unwrap(), ticket);
}

#[test]
fn ticket_rejects_garbage() {
    let code = sample_ticket().encode();
    let body = code.strip_prefix(TICKET_PREFIX).unwrap();
    for bad in [
        String::new(),
        body.to_string(),                                         // no prefix
        format!("ph2_{body}"),                                    // other version
        format!("{TICKET_PREFIX}{body}!"),                        // not base64url
        code[..code.len() - 10].to_string(),                      // truncated
        format!("{TICKET_PREFIX}{}", "A".repeat(MAX_TICKET_LEN)), // oversized
    ] {
        assert!(Ticket::decode(&bad).is_err(), "accepted {bad:?}");
    }
}

#[test]
fn ticket_rejects_port_zero() {
    let ticket = Ticket {
        port: 0,
        ..sample_ticket()
    };
    assert!(Ticket::decode(&ticket.encode()).is_err());
}

#[test]
fn ticket_addr_hides_ips() {
    let addr = sample_ticket().addr;
    let public = ticket_addr(addr.clone());
    assert_eq!(public.id, addr.id);
    assert_eq!(public.ip_addrs().count(), 0);
    assert_eq!(public.relay_urls().count(), 1);
}

// --- UDP framing -------------------------------------------------------------

#[test]
fn frame_roundtrip() {
    for payload in [&b""[..], b"x", &[0xAB; 1200]] {
        let (id, out) = unframe(frame(0xDEAD_BEEF, payload)).unwrap();
        assert_eq!(id, 0xDEAD_BEEF);
        assert_eq!(&out[..], payload);
    }
}

#[test]
fn unframe_rejects_short_datagrams() {
    for short in [&b""[..], b"\x00", b"\x00\x00\x00"] {
        assert!(unframe(Bytes::copy_from_slice(short)).is_none());
    }
}

#[test]
fn flow_table_maps_expires_and_caps() {
    let t0 = Instant::now();
    let mut table = FlowTable::default();
    let a: SocketAddr = "127.0.0.1:1000".parse().unwrap();
    let b: SocketAddr = "127.0.0.1:1001".parse().unwrap();

    let id_a = table.id_for(a, t0).unwrap();
    let id_b = table.id_for(b, t0).unwrap();
    assert_ne!(id_a, id_b);
    assert_eq!(table.id_for(a, t0), Some(id_a));
    assert_eq!(table.addr_of(id_b, t0), Some(b));
    assert_eq!(table.addr_of(12345, t0), None);

    // `a` stays active, `b` goes idle.
    let later = t0 + UDP_FLOW_IDLE - Duration::from_secs(1);
    table.id_for(a, later);
    table.expire(t0 + UDP_FLOW_IDLE);
    assert_eq!(table.addr_of(id_a, later), Some(a));
    assert_eq!(table.addr_of(id_b, later), None);

    // Fill up: new clients are refused until old ones expire.
    for port in 2000..2000 + MAX_UDP_FLOWS as u16 {
        table.id_for(SocketAddr::from((Ipv4Addr::LOCALHOST, port)), later);
    }
    assert_eq!(table.ids.len(), MAX_UDP_FLOWS);
    assert_eq!(table.id_for(b, later), None);
    assert!(table.id_for(b, later + UDP_FLOW_IDLE).is_some());
}

#[test]
fn relay_urls() {
    assert!(parse_relay("https://relay.example.com").is_ok());
    assert!(parse_relay("  http://192.168.1.10:3340/ ").is_ok());
    for bad in [
        "",
        "relay.example.com",
        "ftp://relay.example.com",
        "https://",
        "not a url",
        // Nothing beyond scheme, host and port may leave with the URL.
        "https://relay.example.com/some/path",
        "https://relay.example.com/?q=1",
        "https://relay.example.com/#frag",
        "https://user:pass@relay.example.com",
    ] {
        assert!(parse_relay(bad).is_err(), "{bad:?} should be rejected");
    }
}

// --- Share/join over loopback --------------------------------------------------

/// A relay-less endpoint on 127.0.0.1: the only path is direct, no network needed.
async fn local_endpoint(alpn: bool) -> Endpoint {
    let mut builder = configure(Endpoint::builder(presets::Minimal))
        .relay_mode(RelayMode::Disabled)
        .clear_ip_transports()
        .bind_addr("127.0.0.1:0")
        .unwrap();
    if alpn {
        builder = builder.alpns(vec![ALPN.to_vec()]);
    }
    builder.bind().await.unwrap()
}

async fn local_share(proto: Proto, port: u16) -> Tunnel {
    local_share_max(proto, port, MAX_PEERS).await
}

async fn local_share_max(proto: Proto, port: u16, max_peers: usize) -> Tunnel {
    let endpoint = local_endpoint(true).await;
    let addr = EndpointAddr::from_parts(
        endpoint.id(),
        endpoint.bound_sockets().into_iter().map(TransportAddr::Ip),
    );
    start_share(endpoint, addr, proto, port, max_peers)
}

async fn local_join(ticket: Ticket) -> Tunnel {
    let local = Local::bind(ticket.proto, 0).await.unwrap();
    start_join(local_endpoint(false).await, ticket, local).unwrap()
}

fn ticket_of(tunnel: &Tunnel) -> Ticket {
    Ticket::decode(tunnel.ticket.as_deref().unwrap()).unwrap()
}

async fn wait_for(tunnel: &Tunnel, what: &str, done: impl Fn(&TunnelInfo) -> bool) -> TunnelInfo {
    for _ in 0..100 {
        let info = tunnel.info(1);
        if done(&info) {
            return info;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let info = tunnel.info(1);
    panic!("timed out waiting for {what}: {:?} {:?}", info.phase, info.problem);
}

#[tokio::test]
async fn tcp_share_join() {
    // The shared service: an echo server.
    let server = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let service_port = server.local_addr().unwrap().port();
    let (closed_tx, mut closed_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((mut s, _)) = server.accept().await {
            let closed_tx = closed_tx.clone();
            tokio::spawn(async move {
                let (mut r, mut w) = s.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
                let _ = closed_tx.send(());
            });
        }
    });

    let host = local_share(Proto::Tcp, service_port).await;
    let guest = local_join(ticket_of(&host)).await;
    wait_for(&guest, "the joiner to connect", |i| i.peers == 1 && i.path == "direct").await;

    // Two concurrent client connections, each gets its own echo.
    for msg in [&b"hello through the tunnel"[..], b"second connection"] {
        let mut client = TcpStream::connect((Ipv4Addr::LOCALHOST, guest.port)).await.unwrap();
        client.write_all(msg).await.unwrap();
        let mut buf = vec![0u8; msg.len()];
        tokio::time::timeout(Duration::from_secs(5), client.read_exact(&mut buf))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(buf, msg);
    }
    wait_for(&host, "the host to see the peer", |i| i.peers == 1).await;
    for _ in 0..2 {
        tokio::time::timeout(Duration::from_secs(5), closed_rx.recv())
            .await
            .unwrap();
    }

    // An idle connection: stopping must still close its service side (no leaked task).
    let mut idle = TcpStream::connect((Ipv4Addr::LOCALHOST, guest.port)).await.unwrap();
    idle.write_all(b"x").await.unwrap();
    let mut x = [0u8; 1];
    tokio::time::timeout(Duration::from_secs(5), idle.read_exact(&mut x))
        .await
        .unwrap()
        .unwrap();

    let port = guest.port;
    guest.stop().await;
    host.stop().await;
    tokio::time::timeout(Duration::from_secs(5), closed_rx.recv())
        .await
        .expect("service connection left open");
    // Stopping releases the local port.
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await.unwrap();
}

#[tokio::test]
async fn udp_share_join() {
    let server = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let service_port = server.local_addr().unwrap().port();
    tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        while let Ok((n, from)) = server.recv_from(&mut buf).await {
            let _ = server.send_to(&buf[..n], from).await;
        }
    });

    let host = local_share(Proto::Udp, service_port).await;
    let guest = local_join(ticket_of(&host)).await;
    wait_for(&guest, "the joiner to connect", |i| i.peers == 1).await;

    // Two local clients: replies must go back to the right one.
    for msg in [&b"ping from client 1"[..], b"ping from client 2"] {
        let client = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        client.connect((Ipv4Addr::LOCALHOST, guest.port)).await.unwrap();
        let mut buf = [0u8; 2048];
        let mut echoed = None;
        // UDP: retry until the tunnel delivers.
        for _ in 0..20 {
            client.send(msg).await.unwrap();
            if let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(250), client.recv(&mut buf)).await {
                echoed = Some(buf[..n].to_vec());
                break;
            }
        }
        assert_eq!(echoed.as_deref(), Some(msg));
    }

    guest.stop().await;
    host.stop().await;
}

#[tokio::test]
async fn full_share_refuses_a_second_joiner() {
    let server = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let host = local_share_max(Proto::Tcp, server.local_addr().unwrap().port(), 1).await;
    let first = local_join(ticket_of(&host)).await;
    wait_for(&first, "the first joiner to connect", |i| i.peers == 1).await;

    let second = local_join(ticket_of(&host)).await;
    let info = wait_for(&second, "the second joiner to be refused", |i| i.phase == Phase::Failed).await;
    assert_eq!(info.problem.map(|p| p.kind), Some(ErrorKind::Full));
    let host_info = wait_for(&host, "the host to count the refusal", |i| i.refused == 1).await;
    assert_eq!(host_info.peers, 1);
    assert_eq!(host_info.max_peers, Some(1));
    // The first joiner is unaffected.
    assert_eq!(first.info(1).peers, 1);

    second.stop().await;
    first.stop().await;
    host.stop().await;
}

#[tokio::test]
async fn wrong_token_is_refused() {
    let host = local_share(Proto::Tcp, 9).await;
    let mut ticket = ticket_of(&host);
    ticket.token[0] ^= 1;
    let guest = local_join(ticket).await;

    let info = wait_for(&guest, "the joiner to give up", |i| i.phase == Phase::Failed).await;
    assert_eq!(info.problem.map(|p| p.kind), Some(ErrorKind::WrongCode));
    assert_eq!(host.info(1).peers, 0);
    assert_eq!(host.info(1).problem.map(|p| p.kind), Some(ErrorKind::WrongCode));

    guest.stop().await;
    host.stop().await;
}

#[tokio::test]
async fn joiner_reconnects_after_a_drop() {
    let server = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let host = local_share_max(Proto::Tcp, server.local_addr().unwrap().port(), 1).await;
    let guest = local_join(ticket_of(&host)).await;
    wait_for(&guest, "the joiner to connect", |i| i.phase == Phase::Connected).await;

    // The host drops the connection: the joiner comes back and takes its own place again,
    // even though the share only has one.
    for conn in lock(&host.shared.conns).iter() {
        conn.close(0u32.into(), b"test drop");
    }
    wait_for(&guest, "the joiner to notice the drop", |i| {
        i.phase == Phase::Reconnecting
    })
    .await;
    wait_for(&guest, "the joiner to reconnect", |i| {
        i.phase == Phase::Connected && i.peers == 1
    })
    .await;
    let host_info = wait_for(&host, "the host to see the joiner again", |i| i.peers == 1).await;
    assert_eq!(host_info.refused, 0);

    guest.stop().await;
    host.stop().await;
}

#[tokio::test]
async fn local_port_in_use_is_reported() {
    let taken = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let port = taken.local_addr().unwrap().port();
    let err = Local::bind(Proto::Tcp, port).await.err().unwrap();
    assert_eq!(err, Problem::with(ErrorKind::PortInUse, port));
}

#[tokio::test]
async fn tcp_service_on_ipv6_loopback_only() {
    // Machines without IPv6 loopback can't run this one.
    let Ok(server) = TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).await else {
        return;
    };
    let service = Service {
        port: server.local_addr().unwrap().port(),
        v6: AtomicBool::new(false),
    };
    if TcpStream::connect((Ipv4Addr::LOCALHOST, service.port)).await.is_ok() {
        return; // Something else listens on the same port number over IPv4.
    }
    service.connect_tcp().await.unwrap();
    assert!(
        service.v6.load(Ordering::Relaxed),
        "IPv6 should be tried first from now on"
    );
}
