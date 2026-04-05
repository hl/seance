/// A byte buffer that stores raw PTY output with a configurable byte cap.
/// When the buffer exceeds the cap, it trims from the front at the nearest
/// newline boundary to avoid splitting a line mid-stream.

const DEFAULT_CAP: usize = 8 * 1024 * 1024; // 8 MB

pub struct ScrollbackBuffer {
    buf: Vec<u8>,
    cap: usize,
}

impl ScrollbackBuffer {
    pub fn new() -> Self {
        Self {
            buf: Vec::new(),
            cap: DEFAULT_CAP,
        }
    }

    pub fn with_cap(cap: usize) -> Self {
        Self {
            buf: Vec::new(),
            cap,
        }
    }

    /// Append a chunk of PTY output. If the buffer exceeds the cap after
    /// appending, trim from the front at the nearest newline boundary.
    pub fn append(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
        if self.buf.len() > self.cap {
            let excess = self.buf.len() - self.cap;
            // Find the first newline at or after the excess point so we trim
            // on a line boundary.
            let trim_to = match self.buf[excess..].iter().position(|&b| b == b'\n') {
                Some(offset) => excess + offset + 1, // trim past the newline
                None => excess, // no newline found — just trim at the byte boundary
            };
            self.buf.drain(..trim_to);
        }
    }

    /// Return a clone of the current buffer contents.
    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.clone()
    }

    /// Clear the buffer.
    pub fn reset(&mut self) {
        self.buf.clear();
    }

    /// Current byte length.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_append_and_snapshot() {
        let mut sb = ScrollbackBuffer::new();
        sb.append(b"hello ");
        sb.append(b"world\n");
        assert_eq!(sb.snapshot(), b"hello world\n");
    }

    #[test]
    fn test_multiple_chunks_preserve_order() {
        let mut sb = ScrollbackBuffer::new();
        for i in 0..100 {
            sb.append(format!("line {}\n", i).as_bytes());
        }
        let snap = sb.snapshot();
        let text = String::from_utf8(snap).unwrap();
        assert!(text.starts_with("line 0\n"));
        assert!(text.ends_with("line 99\n"));
        assert_eq!(text.lines().count(), 100);
    }

    #[test]
    fn test_overflow_trims_at_newline_boundary() {
        // Use a small cap so we can test overflow easily.
        let mut sb = ScrollbackBuffer::with_cap(50);

        // Write 60 bytes of content with newlines every 10 bytes.
        for i in 0..6 {
            sb.append(format!("line-{:03}\n", i).as_bytes()); // each is 9 bytes
        }
        // Total: 54 bytes, cap 50 → should trim from front at a newline boundary.
        assert!(sb.len() <= 50, "buffer should be at or under cap");

        let snap = sb.snapshot();
        let text = String::from_utf8(snap).unwrap();
        // The oldest lines should be trimmed, but remaining lines should be complete.
        for line in text.lines() {
            assert!(
                line.starts_with("line-"),
                "each line should be intact: got '{}'",
                line
            );
        }
    }

    #[test]
    fn test_overflow_large_data() {
        let cap = 8 * 1024 * 1024; // 8 MB
        let mut sb = ScrollbackBuffer::new();

        // Write 9 MB of data in lines.
        let line = "A".repeat(99) + "\n"; // 100 bytes per line
        let line_bytes = line.as_bytes();
        let total_lines = (9 * 1024 * 1024) / 100;
        for _ in 0..total_lines {
            sb.append(line_bytes);
        }

        assert!(
            sb.len() <= cap,
            "buffer should be at or under 8MB cap, was {}",
            sb.len()
        );

        // Buffer content should end with complete lines.
        let snap = sb.snapshot();
        assert!(
            snap.last() == Some(&b'\n'),
            "buffer should end with a newline"
        );
    }

    #[test]
    fn test_overflow_no_newlines_still_trims() {
        let mut sb = ScrollbackBuffer::with_cap(20);
        // Write 30 bytes with no newlines at all.
        sb.append(&[b'X'; 30]);
        assert!(
            sb.len() <= 20,
            "buffer should trim even without newlines"
        );
    }

    #[test]
    fn test_reset_clears_buffer() {
        let mut sb = ScrollbackBuffer::new();
        sb.append(b"some data\n");
        assert!(!sb.snapshot().is_empty());
        sb.reset();
        assert!(sb.snapshot().is_empty());
        assert_eq!(sb.len(), 0);
    }

    #[test]
    fn test_empty_append() {
        let mut sb = ScrollbackBuffer::new();
        sb.append(b"");
        assert!(sb.snapshot().is_empty());
    }
}
