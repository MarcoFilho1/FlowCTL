//! Where the mod reaches the overlay (mod/live/transport.ts). On macOS and
//! Linux, HTTP over a Unix socket at ~/.flowctl/overlay.sock, as the Swift
//! app. On Windows, HTTP on 127.0.0.1 at a port the system picks, written with
//! a token to ~/.flowctl/overlay.json; a request without the token gets 401.
//! One request per connection, served on a thread of its own.

use crate::core::http::{Parsed, Parser, Request, Response};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub type Handler = Arc<dyn Fn(Request) -> Response + Send + Sync>;

pub const TOKEN_HEADER: &str = "x-flowctl-token";

/// What `serve` left on disk, removed by `close` when the app quits.
pub struct Endpoint {
    path: PathBuf,
}

impl Endpoint {
    pub fn close(&self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn serve_stream<S: Read + Write>(mut stream: S, handler: &Handler, token: Option<&str>) {
    let mut parser = Parser::new();
    let mut chunk = vec![0u8; 64 * 1024];
    let response = loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break Response::bad_request("incomplete request"),
            Ok(n) => match parser.feed(&chunk[..n]) {
                Parsed::NeedMore => continue,
                Parsed::Failed(response) => break response,
                Parsed::Complete(request) => {
                    let allowed = token.is_none_or(|token| request.headers.get(TOKEN_HEADER).is_some_and(|sent| same(sent, token)));
                    break if allowed { handler(request) } else { Response::unauthorized() };
                }
            },
        }
    };
    let _ = stream.write_all(&response.serialized());
    let _ = stream.flush();
}

/// Compares in time that does not depend on where the strings differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn ask(mut stream: impl Read + Write, request: &str) -> bool {
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 12];
    stream.read_exact(&mut head).is_ok() && &head == b"HTTP/1.1 200"
}

fn request_text(method: &str, path: &str, token: Option<&str>) -> String {
    let token = token.map(|t| format!("X-FlowCTL-Token: {t}\r\n")).unwrap_or_default();
    format!("{method} {path} HTTP/1.1\r\nHost: overlay\r\n{token}Content-Length: 0\r\n\r\n")
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};

    pub fn socket(dir: &Path) -> PathBuf {
        dir.join("overlay.sock")
    }

    /// Asks a running overlay; true when one answered 200.
    pub fn call(dir: &Path, method: &str, path: &str) -> bool {
        let Ok(stream) = UnixStream::connect(socket(dir)) else { return false };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
        ask(stream, &request_text(method, path, None))
    }

    pub fn serve(dir: &Path, handler: Handler) -> std::io::Result<Endpoint> {
        let path = socket(dir);
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let handler = handler.clone();
                std::thread::spawn(move || {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    serve_stream(stream, &handler, None);
                });
            }
        });
        Ok(Endpoint { path })
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};

    pub fn info_file(dir: &Path) -> PathBuf {
        dir.join("overlay.json")
    }

    fn read_info(dir: &Path) -> Option<(u16, String)> {
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(info_file(dir)).ok()?).ok()?;
        Some((u16::try_from(value["port"].as_u64()?).ok()?, value["token"].as_str()?.to_string()))
    }

    /// Asks a running overlay; true when one answered 200.
    pub fn call(dir: &Path, method: &str, path: &str) -> bool {
        let Some((port, token)) = read_info(dir) else { return false };
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_secs(1)) else { return false };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
        ask(stream, &request_text(method, path, Some(&token)))
    }

    pub fn serve(dir: &Path, handler: Handler) -> std::io::Result<Endpoint> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let token = crate::system::token();
        let info = serde_json::json!({
            "port": port,
            "token": token,
            "pid": std::process::id(),
            "version": env!("CARGO_PKG_VERSION"),
        });
        let path = info_file(dir);
        crate::system::write_atomically(&path, info.to_string().as_bytes())?;
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (handler, token) = (handler.clone(), token.clone());
                std::thread::spawn(move || {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    serve_stream(stream, &handler, Some(&token));
                });
            }
        });
        Ok(Endpoint { path })
    }
}

pub use platform::{call, serve};

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A connection that reads `input` and keeps what is written.
    struct Fake {
        input: Cursor<Vec<u8>>,
        output: Vec<u8>,
    }

    impl Read for Fake {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.input.read(buf)
        }
    }
    impl Write for Fake {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.output.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn served(input: &str, token: Option<&str>) -> String {
        let handler: Handler = Arc::new(|request: Request| Response::ok(&format!("{} {}\n", request.method, request.path)));
        let mut fake = Fake { input: Cursor::new(input.as_bytes().to_vec()), output: Vec::new() };
        serve_stream(&mut fake, &handler, token);
        String::from_utf8(fake.output).unwrap()
    }

    #[test]
    fn the_token_is_checked_when_there_is_one() {
        assert!(served(&request_text("GET", "/health", None), None).ends_with("GET /health\n"));
        assert!(served(&request_text("GET", "/health", None), Some("abc")).starts_with("HTTP/1.1 401"));
        assert!(served(&request_text("GET", "/health", Some("abd")), Some("abc")).starts_with("HTTP/1.1 401"));
        assert!(served(&request_text("GET", "/health", Some("abc")), Some("abc")).starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn a_connection_closed_early_is_a_bad_request() {
        assert!(served("GET /health HTTP/1.1\r\n", None).starts_with("HTTP/1.1 400"));
    }

    #[cfg(unix)]
    #[test]
    fn a_real_socket_answers() {
        let dir = std::env::temp_dir().join(format!("flowctl-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let handler: Handler = Arc::new(|_| Response::ok("ok\n"));
        let endpoint = serve(&dir, handler).unwrap();
        assert!(call(&dir, "GET", "/health"));
        endpoint.close();
        assert!(!call(&dir, "GET", "/health"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
