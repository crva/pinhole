//! P2P port forwarding over iroh (QUIC + hole punching).
//!
//! The host exposes a local TCP/UDP port; the joiner gets the same port on its own
//! localhost. TCP connections map to QUIC bidirectional streams, UDP packets map to
//! QUIC datagrams prefixed with a 4-byte flow id (one flow per local UDP client).
//!
//! Direct-only policy: the relay is only used for rendezvous (QUIC handshake and
//! hole punching coordination). No application byte, the access token included, is
//! exchanged until a direct path is selected, and a connection is closed as soon as
//! iroh selects a relay path.

use std::{
    collections::HashMap,
    future::Future,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use bytes::Bytes;
use iroh::{
    Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, TransportAddr,
    endpoint::{
        Builder, ConnectError, ConnectingError, Connection, ConnectionError, QuicTransportConfig, RecvStream,
        SendStream, VarInt, presets,
    },
};
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::{
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{Semaphore, mpsc},
};
use tokio_util::sync::CancellationToken;

const ALPN: &[u8] = b"pinhole/tunnel/1";
const TICKET_PREFIX: &str = "ph1_";
/// A real code is ~150 characters; anything much longer is not one.
const MAX_TICKET_LEN: usize = 2048;
const TOKEN_LEN: usize = 16;
/// How long the host gets to come online with a relay before sharing fails.
const ONLINE_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the joiner waits for the host to answer through the relay.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// How long hole punching gets before we give up.
const DIRECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Token exchange, once the direct path is up.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// The joiner's first byte on a new TCP stream.
const STREAM_HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// After a drop, how long the joiner keeps trying to get back in before giving up.
const RECONNECT_FOR: Duration = Duration::from_secs(300);
/// Pause before the first reconnection attempt, doubled after each failed one.
const RECONNECT_DELAY: Duration = Duration::from_secs(2);
const RECONNECT_DELAY_MAX: Duration = Duration::from_secs(30);
/// Pause after a failed local `accept` (e.g. out of file descriptors) instead of spinning.
const ACCEPT_ERROR_PAUSE: Duration = Duration::from_millis(100);
/// Highest joiner limit a share can be given (the user picks 1 by default).
/// Mirrored by `MAX_LIMIT` in src/components/ShareForm.tsx.
pub const MAX_PEERS: usize = 16;
/// Connections still in hole punching / token check, per share.
const MAX_PENDING: usize = 8;
/// Concurrent TCP connections per peer (enforced by QUIC on the host, by a semaphore on the joiner).
const MAX_TCP_STREAMS: u32 = 128;
/// Concurrent UDP flows (local clients) per peer.
const MAX_UDP_FLOWS: usize = 64;
/// A UDP flow with no packet in either direction for this long is forgotten.
const UDP_FLOW_IDLE: Duration = Duration::from_secs(120);
/// Packets waiting to be written to a host-side UDP flow socket.
const UDP_FLOW_QUEUE: usize = 64;
/// Largest UDP payload; smaller buffers would truncate (or fail, on Windows).
const UDP_BUF_LEN: usize = 65536;
const FLOW_ID_LEN: usize = 4;

const CLOSE_SETUP_FAILED: u32 = 1;
const CLOSE_RELAY_PATH: u32 = 2;
const CLOSE_BUSY: u32 = 3;
const CLOSE_REPLACED: u32 = 4;
const CLOSE_WRONG_CODE: u32 = 5;

/// Token check answers: accepted, or valid code but no place left.
const ACK_OK: u8 = 1;
const ACK_FULL: u8 = 0;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Proto {
    Tcp,
    Udp,
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Share,
    Join,
}

/// Where a tunnel stands (the UI translates it).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Host: no joiner connected.
    Waiting,
    /// Joiner: first connection attempt.
    Connecting,
    Connected,
    /// Joiner: the connection dropped, trying again for up to `RECONNECT_FOR`.
    Reconnecting,
    /// Joiner: gave up for good; the tunnel stays listed until stopped.
    Failed,
}

/// What went wrong, as a kind the UI translates.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    // Refused before the tunnel starts (returned by `share` / `join`).
    InvalidPort,
    InvalidLimit,
    InvalidCode,
    InvalidRelay,
    PortInUse,
    PortDenied,
    RelayUnreachable,
    Network,
    // A connection attempt that failed (joiner: why it gave up or retries; host: the last attempt).
    NoDirect,
    Unreachable,
    WrongCode,
    Full,
    Timeout,
    Closed,
    RelayPath,
}

impl ErrorKind {
    /// The host said no: trying again can't help.
    fn is_final(self) -> bool {
        matches!(self, ErrorKind::WrongCode | ErrorKind::Full)
    }
}

/// A user-facing error: its kind (the UI translates it), plus technical detail (English)
/// or the value at fault.
/// Never carries text chosen by the other side.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Problem {
    pub kind: ErrorKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Problem {
    fn new(kind: ErrorKind) -> Self {
        Self { kind, detail: None }
    }

    fn with(kind: ErrorKind, detail: impl ToString) -> Self {
        Self {
            kind,
            detail: Some(detail.to_string()),
        }
    }
}

/// What the share code contains: how to reach the host, and the secret it expects.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Ticket {
    addr: EndpointAddr,
    proto: Proto,
    port: u16,
    token: [u8; TOKEN_LEN],
}

impl Ticket {
    fn encode(&self) -> String {
        let bytes = postcard::to_stdvec(self).expect("a ticket always serializes");
        format!("{TICKET_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes))
    }

    fn decode(s: &str) -> Result<Self, Problem> {
        let invalid = || Problem::new(ErrorKind::InvalidCode);
        let s = s.trim();
        if s.len() > MAX_TICKET_LEN {
            return Err(invalid());
        }
        let body = s.strip_prefix(TICKET_PREFIX).ok_or_else(invalid)?;
        let bytes = URL_SAFE_NO_PAD.decode(body).map_err(|_| invalid())?;
        let ticket: Ticket = postcard::from_bytes(&bytes).map_err(|_| invalid())?;
        if ticket.port == 0 {
            return Err(invalid());
        }
        Ok(ticket)
    }
}

/// The address put in the share code: the relay URL alone, so the code doesn't reveal
/// the host's LAN and public IPs to whoever sees it. Direct addresses are exchanged over
/// the (encrypted) connection during hole punching. `share` refuses to go on without a relay.
fn ticket_addr(addr: EndpointAddr) -> EndpointAddr {
    EndpointAddr::from_parts(addr.id, addr.addrs.into_iter().filter(TransportAddr::is_relay))
}

fn check_port(port: u16) -> Result<(), Problem> {
    if port == 0 {
        return Err(Problem::with(ErrorKind::InvalidPort, port));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct TunnelInfo {
    pub id: u32,
    pub role: Role,
    pub proto: Proto,
    pub port: u16,
    pub ticket: Option<String>,
    pub phase: Phase,
    /// Joiner: why it gave up (failed) or the last failed attempt (reconnecting).
    /// Host: why the last connection attempt failed, if any.
    pub problem: Option<Problem>,
    pub peers: usize,
    /// Host: how many joiners may be connected at once.
    pub max_peers: Option<usize>,
    /// Host: joiners who had the right code but were turned away because the share
    /// was full. Unexpected ones mean the code reached someone else.
    pub refused: u32,
    /// "direct", "relay" or "none"
    pub path: &'static str,
    pub rtt_ms: Option<u64>,
    /// Our own home relay (used for rendezvous only).
    pub home_relay: Option<String>,
    /// Cumulative QUIC/UDP traffic of the tunnel, closed connections included.
    pub traffic: Traffic,
    pub uptime_secs: u64,
    pub connections: Vec<ConnInfo>,
}

/// Cumulative UDP-level counters (what actually goes over the network).
#[derive(Serialize, Default, Clone, Copy)]
pub struct Traffic {
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub tx_packets: u64,
    pub rx_packets: u64,
}

impl Traffic {
    fn of(conn: &Connection) -> Self {
        let stats = conn.stats();
        Self {
            tx_bytes: stats.udp_tx.bytes,
            rx_bytes: stats.udp_rx.bytes,
            tx_packets: stats.udp_tx.datagrams,
            rx_packets: stats.udp_rx.datagrams,
        }
    }

    fn add(&mut self, other: Traffic) {
        self.tx_bytes += other.tx_bytes;
        self.rx_bytes += other.rx_bytes;
        self.tx_packets += other.tx_packets;
        self.rx_packets += other.rx_packets;
    }
}

/// One peer connected to this tunnel (a joiner for the host, the host for a joiner).
#[derive(Serialize)]
pub struct ConnInfo {
    pub remote_id: String,
    /// "direct" or "relay"
    pub path: &'static str,
    pub rtt_ms: Option<u64>,
    /// Peer address on the direct path.
    pub direct_addr: Option<String>,
    /// Relay through which the peer was reached for rendezvous.
    pub relay: Option<String>,
    /// Bytes that went through the relay path (handshake + hole punching only).
    pub relay_bytes: u64,
    pub traffic: Traffic,
}

impl ConnInfo {
    fn of(conn: &Connection, traffic: Traffic) -> Self {
        let mut info = ConnInfo {
            remote_id: conn.remote_id().to_string().chars().take(10).collect(),
            path: "relay",
            rtt_ms: None,
            direct_addr: None,
            relay: None,
            relay_bytes: 0,
            traffic,
        };
        let paths = conn.paths();
        for p in paths.iter() {
            let stats = p.stats();
            match p.remote_addr() {
                TransportAddr::Relay(url) => {
                    info.relay = Some(url.to_string());
                    info.relay_bytes += stats.udp_tx.bytes + stats.udp_rx.bytes;
                }
                TransportAddr::Ip(addr) if p.is_selected() => info.direct_addr = Some(addr.to_string()),
                _ => {}
            }
            if p.is_selected() {
                info.path = if p.is_ip() { "direct" } else { "relay" };
                info.rtt_ms = Some(stats.rtt.as_millis() as u64);
            }
        }
        info
    }
}

/// Locks a mutex, ignoring poisoning: the state behind it stays usable even if a
/// task panicked while holding it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Shared {
    conns: Mutex<Vec<Connection>>,
    /// Joiner only: the host derives its phase from its peers.
    phase: Mutex<Phase>,
    /// See `TunnelInfo::problem`.
    problem: Mutex<Option<Problem>>,
    /// Traffic of connections that already closed.
    closed_traffic: Mutex<Traffic>,
    /// Host: valid-code joiners refused because the share was full.
    refused: Mutex<u32>,
    started: Instant,
}

impl Shared {
    fn new(phase: Phase) -> Self {
        Self {
            conns: Mutex::default(),
            phase: Mutex::new(phase),
            problem: Mutex::default(),
            closed_traffic: Mutex::default(),
            refused: Mutex::default(),
            started: Instant::now(),
        }
    }

    fn update(&self, phase: Phase, problem: Option<Problem>) {
        *lock(&self.phase) = phase;
        *lock(&self.problem) = problem;
    }

    fn add_conn(&self, conn: Connection) {
        lock(&self.conns).push(conn);
    }
}

pub struct Tunnel {
    role: Role,
    proto: Proto,
    port: u16,
    max_peers: Option<usize>,
    ticket: Option<String>,
    endpoint: Endpoint,
    shared: Arc<Shared>,
    cancel: CancellationToken,
}

impl Tunnel {
    pub fn info(&self, id: u32) -> TunnelInfo {
        let mut conns = lock(&self.shared.conns);
        let mut closed_traffic = lock(&self.shared.closed_traffic);
        conns.retain(|c| {
            let open = c.close_reason().is_none();
            if !open {
                closed_traffic.add(Traffic::of(c));
            }
            open
        });

        let mut traffic = *closed_traffic;
        let connections: Vec<ConnInfo> = conns
            .iter()
            .map(|c| {
                let t = Traffic::of(c);
                traffic.add(t);
                ConnInfo::of(c, t)
            })
            .collect();

        let path = if connections.iter().any(|c| c.path == "direct") {
            "direct"
        } else if connections.is_empty() {
            "none"
        } else {
            "relay"
        };
        let rtt_ms = connections.iter().filter_map(|c| c.rtt_ms).min();

        let peers = conns.len();
        let phase = match self.role {
            Role::Share if peers > 0 => Phase::Connected,
            Role::Share => Phase::Waiting,
            Role::Join => *lock(&self.shared.phase),
        };

        TunnelInfo {
            id,
            role: self.role,
            proto: self.proto,
            port: self.port,
            ticket: self.ticket.clone(),
            phase,
            problem: lock(&self.shared.problem).clone(),
            peers,
            max_peers: self.max_peers,
            refused: *lock(&self.shared.refused),
            path,
            rtt_ms,
            home_relay: self.endpoint.addr().relay_urls().next().map(|u| u.to_string()),
            traffic,
            uptime_secs: self.shared.started.elapsed().as_secs(),
            connections,
        }
    }

    /// Stops every task of the tunnel (they all run under `cancel`), which closes the
    /// local sockets, then closes the QUIC connections.
    pub async fn stop(self) {
        self.cancel.cancel();
        self.endpoint.close().await;
    }
}

/// Spawns a task that is dropped as soon as the tunnel stops.
fn spawn_cancellable(cancel: &CancellationToken, fut: impl Future<Output = ()> + Send + 'static) {
    let cancel = cancel.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = cancel.cancelled() => {}
            _ = fut => {}
        }
    });
}

// ---------------------------------------------------------------------------
// Host side
// ---------------------------------------------------------------------------

/// Expose `localhost:port` to anyone holding the returned ticket.
/// `relay`: the relay used for the introduction, n0's public ones when `None`.
/// `max_peers`: how many joiners may be connected at once (1 to `MAX_PEERS`).
pub async fn share(proto: Proto, port: u16, max_peers: usize, relay: Option<RelayUrl>) -> Result<Tunnel, Problem> {
    check_port(port)?;
    if !(1..=MAX_PEERS).contains(&max_peers) {
        return Err(Problem::with(ErrorKind::InvalidLimit, format!("1 to {MAX_PEERS}")));
    }
    let endpoint = endpoint_builder(relay.clone())
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| Problem::with(ErrorKind::Network, e))?;
    // Wait for a relay/home address so the ticket is reachable from anywhere.
    let _ = tokio::time::timeout(ONLINE_TIMEOUT, endpoint.online()).await;
    // Without a relay the code would have to carry the host's IP addresses instead.
    if endpoint.addr().relay_urls().next().is_none() {
        endpoint.close().await;
        return Err(Problem {
            kind: ErrorKind::RelayUnreachable,
            detail: relay.map(|u| u.to_string()),
        });
    }
    let addr = ticket_addr(endpoint.addr());
    Ok(start_share(endpoint, addr, proto, port, max_peers))
}

fn start_share(endpoint: Endpoint, addr: EndpointAddr, proto: Proto, port: u16, max_peers: usize) -> Tunnel {
    let token: [u8; TOKEN_LEN] = rand::random();
    let ticket = Ticket {
        addr,
        proto,
        port,
        token,
    }
    .encode();

    let shared = Arc::new(Shared::new(Phase::Waiting));
    let cancel = CancellationToken::new();
    let peers = Arc::new(Peers {
        max: max_peers,
        conns: Mutex::default(),
    });
    let service = Arc::new(Service {
        port,
        v6: AtomicBool::new(false),
    });
    let host = Host {
        shared: shared.clone(),
        cancel: cancel.clone(),
        proto,
        service,
        token,
        peers,
    };
    spawn_cancellable(&cancel, accept_loop(endpoint.clone(), host));

    Tunnel {
        role: Role::Share,
        proto,
        port,
        max_peers: Some(max_peers),
        ticket: Some(ticket),
        endpoint,
        shared,
        cancel,
    }
}

#[derive(Clone)]
struct Host {
    shared: Arc<Shared>,
    cancel: CancellationToken,
    proto: Proto,
    service: Arc<Service>,
    token: [u8; TOKEN_LEN],
    peers: Arc<Peers>,
}

/// The shared local service. TCP tries IPv4 loopback, then IPv6 for services bound to
/// `::1` only (`localhost` resolves there first on many systems), and remembers which
/// one answered. UDP can't tell, so it uses IPv4 loopback only.
struct Service {
    port: u16,
    v6: AtomicBool,
}

impl Service {
    async fn connect_tcp(&self) -> io::Result<TcpStream> {
        let v6 = self.v6.load(Ordering::Relaxed);
        let loopback = |v6: bool| -> IpAddr {
            if v6 {
                Ipv6Addr::LOCALHOST.into()
            } else {
                Ipv4Addr::LOCALHOST.into()
            }
        };
        if let Ok(tcp) = TcpStream::connect((loopback(v6), self.port)).await {
            return Ok(tcp);
        }
        let tcp = TcpStream::connect((loopback(!v6), self.port)).await?;
        self.v6.store(!v6, Ordering::Relaxed);
        Ok(tcp)
    }
}

/// Connected joiners, one place per identity: a joiner that reconnects (same key,
/// e.g. after a Wi-Fi drop) takes back its own place instead of needing a free one.
struct Peers {
    max: usize,
    conns: Mutex<HashMap<EndpointId, Connection>>,
}

impl Peers {
    /// Takes a place for `conn`, or returns false when the share is full.
    fn admit(&self, conn: &Connection) -> bool {
        let mut conns = lock(&self.conns);
        let id = conn.remote_id();
        if let Some(old) = conns.remove(&id) {
            old.close(CLOSE_REPLACED.into(), b"reconnected");
        } else if conns.len() >= self.max {
            return false;
        }
        conns.insert(id, conn.clone());
        true
    }

    /// Frees `conn`'s place, unless a reconnection already took it over (or it had none).
    fn leave(&self, conn: &Connection) {
        let mut conns = lock(&self.conns);
        if conns
            .get(&conn.remote_id())
            .is_some_and(|c| c.stable_id() == conn.stable_id())
        {
            conns.remove(&conn.remote_id());
        }
    }
}

async fn accept_loop(endpoint: Endpoint, host: Host) {
    // Anyone who finds our IP and port can open a QUIC connection with our ALPN, code
    // or not: cap the connections in setup. Authenticated joiners are capped by `Peers`.
    let pending = Arc::new(Semaphore::new(MAX_PENDING));
    while let Some(incoming) = endpoint.accept().await {
        let Ok(setup_slot) = pending.clone().try_acquire_owned() else {
            incoming.refuse();
            continue;
        };
        let host = host.clone();
        let cancel = host.cancel.clone();
        spawn_cancellable(&cancel, async move {
            let Ok(conn) = incoming.await else { return };
            let setup = async {
                wait_direct(&conn).await?;
                spawn_cancellable(&host.cancel, direct_watchdog(conn.clone()));
                tokio::time::timeout(HANDSHAKE_TIMEOUT, server_handshake(&conn, &host))
                    .await
                    .unwrap_or(Err(Problem::new(ErrorKind::Timeout)))
            };
            match setup.await {
                Ok(true) => {}
                Ok(false) => {
                    *lock(&host.shared.refused) += 1;
                    // Let the joiner read the answer before closing.
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    conn.close(CLOSE_BUSY.into(), b"share full");
                    return;
                }
                Err(problem) => {
                    // The place may already be taken if only sending the answer failed.
                    host.peers.leave(&conn);
                    let code = if problem.kind == ErrorKind::WrongCode {
                        CLOSE_WRONG_CODE
                    } else {
                        CLOSE_SETUP_FAILED
                    };
                    *lock(&host.shared.problem) = Some(problem);
                    conn.close(code.into(), b"setup failed");
                    return;
                }
            }
            drop(setup_slot);
            host.shared.add_conn(conn.clone());
            match host.proto {
                Proto::Tcp => serve_tcp(conn.clone(), host.service.clone(), &host.cancel).await,
                Proto::Udp => serve_udp(conn.clone(), host.service.port, &host.cancel).await,
            }
            host.peers.leave(&conn);
        });
    }
}

/// Checks the token, then takes a joiner place. Ok(false): right code, share full.
async fn server_handshake(conn: &Connection, host: &Host) -> Result<bool, Problem> {
    let (mut send, mut recv) = conn.accept_bi().await.map_err(|_| closed(conn))?;
    let mut buf = [0u8; TOKEN_LEN];
    recv.read_exact(&mut buf).await.map_err(|_| closed(conn))?;
    if !bool::from(buf.ct_eq(&host.token)) {
        return Err(Problem::new(ErrorKind::WrongCode));
    }
    let admitted = host.peers.admit(conn);
    send.write_all(&[if admitted { ACK_OK } else { ACK_FULL }])
        .await
        .map_err(|_| closed(conn))?;
    send.finish().map_err(|_| closed(conn))?;
    Ok(admitted)
}

/// Concurrent streams are capped by QUIC (`MAX_TCP_STREAMS`, see `endpoint_builder`).
async fn serve_tcp(conn: Connection, service: Arc<Service>, cancel: &CancellationToken) {
    while let Ok((send, mut recv)) = conn.accept_bi().await {
        let conn = conn.clone();
        let service = service.clone();
        spawn_cancellable(cancel, async move {
            // The joiner writes one byte so the stream becomes visible to us immediately,
            // even for protocols where the server speaks first.
            let mut hello = [0u8; 1];
            if !matches!(
                tokio::time::timeout(STREAM_HELLO_TIMEOUT, recv.read_exact(&mut hello)).await,
                Ok(Ok(()))
            ) {
                return;
            }
            if let Ok(tcp) = service.connect_tcp().await {
                pipe(&conn, tcp, send, recv).await;
            }
        });
    }
}

async fn serve_udp(conn: Connection, port: u16, cancel: &CancellationToken) {
    // Each flow is a task that owns its local socket; it ends (dropping its receiver)
    // after `UDP_FLOW_IDLE` without traffic.
    let mut flows: HashMap<u32, mpsc::Sender<Bytes>> = HashMap::new();
    while let Ok(datagram) = conn.read_datagram().await {
        let Some((id, payload)) = unframe(datagram) else {
            continue;
        };
        if flows.get(&id).is_some_and(mpsc::Sender::is_closed) {
            flows.remove(&id);
        }
        if !flows.contains_key(&id) {
            if flows.len() >= MAX_UDP_FLOWS {
                flows.retain(|_, tx| !tx.is_closed());
                if flows.len() >= MAX_UDP_FLOWS {
                    continue;
                }
            }
            let Ok(sock) = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await else {
                continue;
            };
            // Also filters replies: only the shared service can answer on this socket.
            if sock.connect((Ipv4Addr::LOCALHOST, port)).await.is_err() {
                continue;
            }
            let (tx, rx) = mpsc::channel(UDP_FLOW_QUEUE);
            spawn_cancellable(cancel, udp_flow(conn.clone(), sock, id, rx));
            flows.insert(id, tx);
        }
        // Full queue: drop the packet, like a congested UDP link would.
        let _ = flows[&id].try_send(payload);
    }
}

async fn udp_flow(conn: Connection, sock: UdpSocket, id: u32, mut outbound: mpsc::Receiver<Bytes>) {
    let mut buf = vec![0u8; UDP_BUF_LEN];
    let idle = tokio::time::sleep(UDP_FLOW_IDLE);
    tokio::pin!(idle);
    loop {
        tokio::select! {
            _ = conn.closed() => return,
            _ = &mut idle => return,
            p = outbound.recv() => {
                let Some(payload) = p else { return };
                let _ = sock.send(&payload).await;
            }
            r = sock.recv(&mut buf) => {
                // Windows reports ICMP "port unreachable" as a recv error; just keep going.
                let Ok(n) = r else { continue };
                let _ = conn.send_datagram(frame(id, &buf[..n]));
            }
        }
        idle.as_mut().reset(tokio::time::Instant::now() + UDP_FLOW_IDLE);
    }
}

// ---------------------------------------------------------------------------
// Joiner side
// ---------------------------------------------------------------------------

enum Local {
    Tcp(TcpListener),
    Udp(UdpSocket),
}

impl Local {
    /// Binds on loopback only: the tunnel is never reachable from the LAN.
    async fn bind(proto: Proto, port: u16) -> Result<Self, Problem> {
        let bind_addr = (Ipv4Addr::LOCALHOST, port);
        let bound = match proto {
            Proto::Tcp => TcpListener::bind(bind_addr).await.map(Local::Tcp),
            Proto::Udp => UdpSocket::bind(bind_addr).await.map(Local::Udp),
        };
        bound.map_err(|e| match e.kind() {
            io::ErrorKind::AddrInUse => Problem::with(ErrorKind::PortInUse, port),
            // Privileged ports on Linux, reserved ranges on Windows.
            io::ErrorKind::PermissionDenied => Problem::with(ErrorKind::PortDenied, port),
            _ => Problem::with(ErrorKind::Network, e),
        })
    }

    fn port(&self) -> io::Result<u16> {
        Ok(match self {
            Local::Tcp(l) => l.local_addr()?.port(),
            Local::Udp(s) => s.local_addr()?.port(),
        })
    }
}

/// Connect to a shared port and expose it on `127.0.0.1:local_port`
/// (defaults to the host's port number). The host's relay comes from the ticket;
/// `relay` is only this side's own home relay.
pub async fn join(ticket: &str, local_port: Option<u16>, relay: Option<RelayUrl>) -> Result<Tunnel, Problem> {
    let ticket = Ticket::decode(ticket)?;
    let port = local_port.unwrap_or(ticket.port);
    check_port(port)?;
    let local = Local::bind(ticket.proto, port).await?;
    let endpoint = endpoint_builder(relay)
        .bind()
        .await
        .map_err(|e| Problem::with(ErrorKind::Network, e))?;
    start_join(endpoint, ticket, local)
}

fn start_join(endpoint: Endpoint, ticket: Ticket, local: Local) -> Result<Tunnel, Problem> {
    let port = local.port().map_err(|e| Problem::with(ErrorKind::Network, e))?;
    let shared = Arc::new(Shared::new(Phase::Connecting));
    let cancel = CancellationToken::new();
    let proto = ticket.proto;
    spawn_cancellable(
        &cancel,
        client_loop(endpoint.clone(), shared.clone(), cancel.clone(), ticket, local),
    );

    Ok(Tunnel {
        role: Role::Join,
        proto,
        port,
        max_peers: None,
        ticket: None,
        endpoint,
        shared,
        cancel,
    })
}

/// Connects, forwards until the connection drops, then tries again. The first attempt
/// fails fast (wrong code, no P2P possible…); once connected, a drop is retried with
/// backoff for `RECONNECT_FOR`. Giving up releases the local port. Never falls back
/// to the relay.
async fn client_loop(endpoint: Endpoint, shared: Arc<Shared>, cancel: CancellationToken, ticket: Ticket, local: Local) {
    let mut lost_since: Option<Instant> = None;
    let mut delay = RECONNECT_DELAY;
    loop {
        let problem = match connect(&endpoint, &ticket, &cancel).await {
            Ok(conn) => {
                shared.add_conn(conn.clone());
                shared.update(Phase::Connected, None);
                match &local {
                    Local::Tcp(listener) => client_tcp(&conn, listener, &cancel).await,
                    Local::Udp(sock) => client_udp(&conn, sock).await,
                }
                lost_since = Some(Instant::now());
                delay = RECONNECT_DELAY;
                closed(&conn)
            }
            Err(problem) => {
                let retry = !problem.kind.is_final() && lost_since.is_some_and(|t| t.elapsed() < RECONNECT_FOR);
                if !retry {
                    shared.update(Phase::Failed, Some(problem));
                    endpoint.close().await;
                    return;
                }
                problem
            }
        };
        shared.update(Phase::Reconnecting, Some(problem));
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(RECONNECT_DELAY_MAX);
    }
}

async fn connect(endpoint: &Endpoint, ticket: &Ticket, cancel: &CancellationToken) -> Result<Connection, Problem> {
    let conn = match tokio::time::timeout(CONNECT_TIMEOUT, endpoint.connect(ticket.addr.clone(), ALPN)).await {
        Err(_) => return Err(Problem::new(ErrorKind::Unreachable)),
        Ok(Err(e)) => return Err(Problem::with(ErrorKind::Unreachable, connect_detail(e))),
        Ok(Ok(conn)) => conn,
    };
    let setup = async {
        wait_direct(&conn).await?;
        // Watch from here on: not even the token may cross the relay.
        spawn_cancellable(cancel, direct_watchdog(conn.clone()));
        tokio::time::timeout(HANDSHAKE_TIMEOUT, client_handshake(&conn, &ticket.token))
            .await
            .unwrap_or(Err(Problem::new(ErrorKind::Timeout)))
    };
    if let Err(problem) = setup.await {
        conn.close(CLOSE_SETUP_FAILED.into(), b"setup failed");
        return Err(problem);
    }
    Ok(conn)
}

async fn client_handshake(conn: &Connection, token: &[u8; TOKEN_LEN]) -> Result<(), Problem> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|_| closed(conn))?;
    send.write_all(token).await.map_err(|_| closed(conn))?;
    send.finish().map_err(|_| closed(conn))?;
    let mut ack = [0u8; 1];
    // A wrong code: the host closes the connection with `CLOSE_WRONG_CODE` instead of answering.
    recv.read_exact(&mut ack).await.map_err(|_| closed(conn))?;
    if ack[0] != ACK_OK {
        return Err(Problem::new(ErrorKind::Full));
    }
    Ok(())
}

async fn client_tcp(conn: &Connection, listener: &TcpListener, cancel: &CancellationToken) {
    // Local connections beyond the host's stream limit are dropped instead of piling up.
    let slots = Arc::new(Semaphore::new(MAX_TCP_STREAMS as usize));
    loop {
        tokio::select! {
            _ = conn.closed() => return,
            r = listener.accept() => {
                let Ok((tcp, _)) = r else {
                    tokio::time::sleep(ACCEPT_ERROR_PAUSE).await;
                    continue;
                };
                let Ok(slot) = slots.clone().try_acquire_owned() else { continue };
                let conn = conn.clone();
                spawn_cancellable(cancel, async move {
                    let _slot = slot;
                    let Ok((mut send, recv)) = conn.open_bi().await else { return };
                    if send.write_all(&[0]).await.is_err() {
                        return;
                    }
                    pipe(&conn, tcp, send, recv).await;
                });
            }
        }
    }
}

async fn client_udp(conn: &Connection, sock: &UdpSocket) {
    let mut flows = FlowTable::default();
    let mut sweep = tokio::time::interval(UDP_FLOW_IDLE / 4);
    let mut buf = vec![0u8; UDP_BUF_LEN];
    loop {
        tokio::select! {
            _ = sweep.tick() => flows.expire(Instant::now()),
            r = sock.recv_from(&mut buf) => {
                let Ok((n, from)) = r else { continue };
                if let Some(id) = flows.id_for(from, Instant::now()) {
                    let _ = conn.send_datagram(frame(id, &buf[..n]));
                }
            }
            r = conn.read_datagram() => {
                let Ok(datagram) = r else { return };
                if let Some((id, payload)) = unframe(datagram)
                    && let Some(addr) = flows.addr_of(id, Instant::now())
                {
                    let _ = sock.send_to(&payload, addr).await;
                }
            }
        }
    }
}

/// Joiner side: local UDP clients, each mapped to a flow id, forgotten after
/// `UDP_FLOW_IDLE` without traffic and capped at `MAX_UDP_FLOWS`.
#[derive(Default)]
struct FlowTable {
    ids: HashMap<SocketAddr, u32>,
    flows: HashMap<u32, (SocketAddr, Instant)>,
    next_id: u32,
}

impl FlowTable {
    /// The flow id of a local client, or `None` when the table is full.
    fn id_for(&mut self, addr: SocketAddr, now: Instant) -> Option<u32> {
        if let Some(&id) = self.ids.get(&addr) {
            self.flows.insert(id, (addr, now));
            return Some(id);
        }
        if self.ids.len() >= MAX_UDP_FLOWS {
            self.expire(now);
            if self.ids.len() >= MAX_UDP_FLOWS {
                return None;
            }
        }
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        self.ids.insert(addr, id);
        self.flows.insert(id, (addr, now));
        Some(id)
    }

    fn addr_of(&mut self, id: u32, now: Instant) -> Option<SocketAddr> {
        let (addr, seen) = self.flows.get_mut(&id)?;
        *seen = now;
        Some(*addr)
    }

    fn expire(&mut self, now: Instant) {
        self.flows
            .retain(|_, (_, seen)| now.duration_since(*seen) < UDP_FLOW_IDLE);
        let flows = &self.flows;
        self.ids.retain(|_, id| flows.contains_key(id));
    }
}

// ---------------------------------------------------------------------------
// Direct-path enforcement
// ---------------------------------------------------------------------------

/// A self-hosted relay URL (an `iroh-relay` server), checked before any network use.
/// Just scheme, host and port: nothing else should leave the machine with it.
pub fn parse_relay(url: &str) -> Result<RelayUrl, Problem> {
    let url = url.trim();
    let invalid = || Problem::with(ErrorKind::InvalidRelay, url);
    let parsed: RelayUrl = url.parse().map_err(|_| invalid())?;
    let plain = matches!(parsed.scheme(), "https" | "http")
        && parsed.host_str().is_some_and(|h| !h.is_empty())
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none();
    if !plain {
        return Err(invalid());
    }
    Ok(parsed)
}

fn endpoint_builder(relay: Option<RelayUrl>) -> Builder {
    let mut builder = configure(Endpoint::builder(presets::N0));
    if let Some(url) = relay {
        builder = builder.relay_mode(RelayMode::custom([url]));
    }
    // Debug builds only: simulate a network where hole punching can't work.
    #[cfg(debug_assertions)]
    if std::env::var_os("PINHOLE_FORCE_RELAY").is_some() {
        return builder.clear_ip_transports();
    }
    builder
}

fn configure(builder: Builder) -> Builder {
    let transport = QuicTransportConfig::builder()
        .max_concurrent_bidi_streams(VarInt::from_u32(MAX_TCP_STREAMS))
        // Unused by the protocol.
        .max_concurrent_uni_streams(VarInt::from_u32(0))
        .build();
    builder.transport_config(transport)
}

/// Resolves once a direct (IP) path carries the connection's data.
async fn wait_direct(conn: &Connection) -> Result<(), Problem> {
    let mut paths = conn.paths_stream();
    let direct = async {
        while let Some(list) = paths.next().await {
            if list.iter().any(|p| p.is_selected() && p.is_ip()) {
                return Ok(());
            }
        }
        Err(closed(conn))
    };
    tokio::time::timeout(DIRECT_TIMEOUT, direct)
        .await
        .unwrap_or(Err(Problem::new(ErrorKind::NoDirect)))
}

/// Closes the connection as soon as iroh switches data to a relay path. Packets queued
/// in the few milliseconds before this runs can still go through the relay (iroh has
/// no switch to forbid it); they are end-to-end encrypted.
async fn direct_watchdog(conn: Connection) {
    let mut paths = conn.paths_stream();
    while let Some(list) = paths.next().await {
        if list.iter().any(|p| p.is_selected() && p.is_relay()) {
            conn.close(CLOSE_RELAY_PATH.into(), b"direct path lost");
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Why `conn` closed (or failed a stream operation), from its close code.
fn closed(conn: &Connection) -> Problem {
    let reason = conn.close_reason();
    let app_code = match &reason {
        Some(ConnectionError::ApplicationClosed(c)) => u32::try_from(c.error_code.into_inner()).ok(),
        _ => None,
    };
    let kind = match (app_code, &reason) {
        (Some(CLOSE_WRONG_CODE), _) => ErrorKind::WrongCode,
        (Some(CLOSE_BUSY), _) => ErrorKind::Full,
        (Some(CLOSE_RELAY_PATH), _) => ErrorKind::RelayPath,
        (_, Some(ConnectionError::TimedOut)) => ErrorKind::Timeout,
        _ => ErrorKind::Closed,
    };
    Problem {
        kind,
        detail: reason.map(close_detail),
    }
}

/// A close reason without the peer's free-text part: whoever connects can put anything
/// there, and it would end up in the UI.
fn close_detail(reason: ConnectionError) -> String {
    match reason {
        ConnectionError::ApplicationClosed(c) => format!("closed by the other side, code {}", c.error_code),
        ConnectionError::ConnectionClosed(c) => format!("aborted by the other side, {}", c.error_code),
        ConnectionError::TransportError(e) => format!("protocol error, {}", e.code),
        other => other.to_string(),
    }
}

fn connect_detail(e: ConnectError) -> String {
    match e {
        ConnectError::Connection { source, .. }
        | ConnectError::Connecting {
            source: ConnectingError::ConnectionError { source, .. },
            ..
        } => close_detail(source),
        other => other.to_string(),
    }
}

/// Copies both ways until both directions finish or the connection closes (an idle
/// local socket would otherwise keep the task alive forever).
async fn pipe(conn: &Connection, tcp: TcpStream, mut send: SendStream, mut recv: RecvStream) {
    let _ = tcp.set_nodelay(true);
    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let up = async {
        let _ = tokio::io::copy(&mut tcp_read, &mut send).await;
        let _ = send.finish();
    };
    let down = async {
        let _ = tokio::io::copy(&mut recv, &mut tcp_write).await;
        let _ = tcp_write.shutdown().await;
    };
    tokio::select! {
        _ = conn.closed() => {}
        _ = async { tokio::join!(up, down) } => {}
    }
}

fn frame(id: u32, payload: &[u8]) -> Bytes {
    let mut buf = Vec::with_capacity(FLOW_ID_LEN + payload.len());
    buf.extend_from_slice(&id.to_be_bytes());
    buf.extend_from_slice(payload);
    buf.into()
}

fn unframe(datagram: Bytes) -> Option<(u32, Bytes)> {
    let id = datagram.first_chunk::<FLOW_ID_LEN>()?;
    Some((u32::from_be_bytes(*id), datagram.slice(FLOW_ID_LEN..)))
}

#[cfg(test)]
mod tests;
