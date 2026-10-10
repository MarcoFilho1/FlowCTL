//! An incremental HTTP/1.1 request parser for one request per connection, as
//! the macOS app's (apps/overlay/Sources/FlowCTLCore/HTTP.swift): feed it bytes
//! as they arrive. Bodies need `Content-Length`; chunked transfer is refused
//! (411), which `$.http.fetch` never needs.

use std::collections::HashMap;

pub const MAX_HEADER_BYTES: usize = 64 * 1024;
pub const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    /// The request target without its query string.
    pub path: String,
    /// What follows `?` in the target, undecoded; empty without one.
    pub query: String,
    /// Header names lowercased.
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub body: String,
}

impl Response {
    pub fn ok(body: &str) -> Self {
        Self { status: 200, reason: "OK", body: body.to_string() }
    }
    pub fn bad_request(why: &str) -> Self {
        Self { status: 400, reason: "Bad Request", body: format!("{why}\n") }
    }
    pub fn unauthorized() -> Self {
        Self { status: 401, reason: "Unauthorized", body: "missing or wrong token\n".into() }
    }
    pub fn not_found() -> Self {
        Self { status: 404, reason: "Not Found", body: "not found\n".into() }
    }
    pub fn method_not_allowed() -> Self {
        Self { status: 405, reason: "Method Not Allowed", body: "method not allowed\n".into() }
    }
    pub fn length_required() -> Self {
        Self { status: 411, reason: "Length Required", body: "send a Content-Length body\n".into() }
    }
    pub fn too_large() -> Self {
        Self { status: 413, reason: "Payload Too Large", body: "too large\n".into() }
    }

    /// The bytes on the wire; every connection closes after one response.
    pub fn serialized(&self) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.status,
            self.reason,
            self.body.len()
        )
        .into_bytes();
        out.extend_from_slice(self.body.as_bytes());
        out
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    NeedMore,
    Complete(Request),
    Failed(Response),
}

struct Head {
    method: String,
    path: String,
    query: String,
    headers: HashMap<String, String>,
    body_start: usize,
    length: usize,
}

#[derive(Default)]
pub struct Parser {
    buffer: Vec<u8>,
    head: Option<Head>,
}

impl Parser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Parsed {
        self.buffer.extend_from_slice(bytes);
        if self.head.is_none() {
            let Some(end) = find(&self.buffer, b"\r\n\r\n") else {
                return if self.buffer.len() > MAX_HEADER_BYTES {
                    Parsed::Failed(Response::bad_request("headers too large"))
                } else {
                    Parsed::NeedMore
                };
            };
            match parse_head(&self.buffer[..end]) {
                Err(response) => return Parsed::Failed(response),
                Ok((method, path, query, headers, length)) => {
                    self.head = Some(Head { method, path, query, headers, body_start: end + 4, length });
                }
            }
        }
        let head = self.head.as_ref().expect("set above");
        if self.buffer.len() - head.body_start < head.length {
            return Parsed::NeedMore;
        }
        Parsed::Complete(Request {
            method: head.method.clone(),
            path: head.path.clone(),
            query: head.query.clone(),
            headers: head.headers.clone(),
            body: self.buffer[head.body_start..head.body_start + head.length].to_vec(),
        })
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

type ParsedHead = (String, String, String, HashMap<String, String>, usize);

fn parse_head(data: &[u8]) -> Result<ParsedHead, Response> {
    let text = std::str::from_utf8(data).map_err(|_| Response::bad_request("headers are not UTF-8"))?;
    let mut lines = text.split("\r\n");
    let parts: Vec<&str> = lines.next().unwrap_or("").split(' ').filter(|part| !part.is_empty()).collect();
    if parts.len() != 3 || !parts[2].starts_with("HTTP/1.") {
        return Err(Response::bad_request("bad request line"));
    }

    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let Some((name, value)) = line.split_once(':') else {
            return Err(Response::bad_request("bad header line"));
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        if name == "content-length" {
            if let Some(existing) = headers.get(&name) {
                if *existing != value {
                    return Err(Response::bad_request("conflicting content-length"));
                }
            }
        }
        headers.insert(name, value);
    }

    if headers.contains_key("transfer-encoding") {
        return Err(Response::length_required());
    }
    let mut length = 0;
    if let Some(raw) = headers.get("content-length") {
        if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Response::bad_request("bad content-length"));
        }
        length = raw.parse::<usize>().map_err(|_| Response::bad_request("bad content-length"))?;
    }
    if length > MAX_BODY_BYTES {
        return Err(Response::too_large());
    }

    let (path, query) = match parts[1].split_once('?') {
        Some((path, query)) => (path.to_string(), query.to_string()),
        None => (parts[1].to_string(), String::new()),
    };
    Ok((parts[0].to_string(), path, query, headers, length))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn whole(bytes: &[u8]) -> Parsed {
        Parser::new().feed(bytes)
    }

    #[test]
    fn a_post_with_a_body_arrives_in_pieces() {
        let mut parser = Parser::new();
        assert_eq!(parser.feed(b"POST /snapshot?x=1 HTTP/1.1\r\nContent-Length: 4\r\nX-FlowCTL-Token: t"), Parsed::NeedMore);
        assert_eq!(parser.feed(b"\r\n\r\nab"), Parsed::NeedMore);
        let Parsed::Complete(request) = parser.feed(b"cd") else { panic!("not complete") };
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/snapshot");
        assert_eq!(request.query, "x=1");
        assert_eq!(request.headers.get("x-flowctl-token").map(String::as_str), Some("t"));
        assert_eq!(request.body, b"abcd");
    }

    #[test]
    fn a_get_without_length_has_no_body() {
        let Parsed::Complete(request) = whole(b"GET /health HTTP/1.1\r\nHost: overlay\r\n\r\n") else { panic!() };
        assert!(request.body.is_empty());
    }

    #[test]
    fn what_is_refused() {
        assert_eq!(whole(b"GET /health\r\n\r\n"), Parsed::Failed(Response::bad_request("bad request line")));
        assert_eq!(whole(b"GET / HTTP/1.1\r\nnope\r\n\r\n"), Parsed::Failed(Response::bad_request("bad header line")));
        assert_eq!(
            whole(b"POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n"),
            Parsed::Failed(Response::bad_request("conflicting content-length"))
        );
        assert_eq!(whole(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"), Parsed::Failed(Response::length_required()));
        assert_eq!(whole(b"POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n"), Parsed::Failed(Response::bad_request("bad content-length")));
        assert_eq!(whole(b"POST / HTTP/1.1\r\nContent-Length: 9000000\r\n\r\n"), Parsed::Failed(Response::too_large()));
        let huge = vec![b'a'; MAX_HEADER_BYTES + 1];
        assert_eq!(whole(&huge), Parsed::Failed(Response::bad_request("headers too large")));
    }

    #[test]
    fn a_response_closes_the_connection() {
        let wire = String::from_utf8(Response::ok("accepted\n").serialized()).unwrap();
        assert_eq!(
            wire,
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 9\r\nConnection: close\r\n\r\naccepted\n"
        );
    }
}
