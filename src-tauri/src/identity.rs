use uuid::Uuid;

/// Generate a deterministic default name from a session UUID.
///
/// Returns `Agent-{first 4 chars of UUID}`, e.g. `Agent-a1b2`.
pub fn default_name(session_id: Uuid) -> String {
    let uuid_str = session_id.to_string();
    format!("Agent-{}", &uuid_str[..4])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_name_format() {
        let id = Uuid::parse_str("a1b2c3d4-e5f6-7890-abcd-ef1234567890").unwrap();
        let name = default_name(id);
        assert_eq!(name, "Agent-a1b2");
    }

    #[test]
    fn test_default_name_is_4_chars_after_prefix() {
        let id = Uuid::new_v4();
        let name = default_name(id);
        assert!(name.starts_with("Agent-"));
        // "Agent-" is 6 chars, plus 4 UUID chars = 10 total
        assert_eq!(name.len(), 10);
    }
}
