//! A small framed-record decoder.

#[derive(Debug)]
pub enum Error {
    OutOfRange,
    BadUtf8,
}

pub struct Header {
    pub len: u32,
    pub count: u32,
}

pub fn field(buf: &[u8], idx: usize) -> u8 {
    unsafe { *buf.get_unchecked(idx) }
}

pub fn checked_field(buf: &[u8], idx: usize) -> Result<u8, Error> {
    buf.get(idx).copied().ok_or(Error::OutOfRange)
}

pub fn records(header: &Header) -> Vec<u8> {
    let total = header.len as usize * header.count as usize;
    vec![0u8; total]
}

pub fn name(buf: &[u8], n: usize) -> Result<&str, Error> {
    let bytes = buf.get(..n).ok_or(Error::OutOfRange)?;
    std::str::from_utf8(bytes).map_err(|_| Error::BadUtf8)?;
    Ok(unsafe { std::str::from_utf8_unchecked(bytes) })
}
