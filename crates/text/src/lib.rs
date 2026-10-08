use unicode_normalization::UnicodeNormalization;

/// Normalizes Nepali text according to linguistic and orthographic rules.
#[derive(Debug, Clone, Default)]
pub struct TextNormalizer {
    pub auto_punctuation: bool,
    pub devanagari_numerals: bool,
}

impl TextNormalizer {
    pub fn new() -> Self {
        Self {
            auto_punctuation: true,
            devanagari_numerals: true,
        }
    }

    /// Normalizes raw Nepali ASR output into clean, typed Devanagari text.
    pub fn normalize(&self, input: &str) -> String {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        // 1. Unicode NFC normalization (combines base chars + nuktas/matras properly)
        let mut text: String = trimmed.nfc().collect();

        // 2. Collapse redundant whitespace (spaces, tabs, newlines)
        text = text.split_whitespace().collect::<Vec<_>>().join(" ");

        // 3. Remove stutter/duplicate words (e.g., "म म" -> "म" if repeated consecutively)
        text = deduplicate_consecutive_words(&text);

        // 4. Digits conversion (if devanagari_numerals enabled, 0-9 -> ०-९)
        if self.devanagari_numerals {
            text = convert_digits_to_devanagari(&text);
        }

        // 5. Clean punctuation spacing:
        // Ensure no space before ।, ?, !, ,, and single space after if followed by word.
        text = clean_punctuation_spacing(&text);

        // 6. Sentence ending punctuation (terminal danda)
        if self.auto_punctuation && !text.is_empty() {
            let last_char = text.chars().last().unwrap();
            if !['।', '?', '!', '.', '…'].contains(&last_char) {
                text.push('।');
            }
        }

        text
    }
}

/// Converts ASCII digits 0-9 to Devanagari digits ०-९
pub fn convert_digits_to_devanagari(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            '0' => '०',
            '1' => '१',
            '2' => '२',
            '3' => '३',
            '4' => '४',
            '5' => '५',
            '6' => '६',
            '7' => '७',
            '8' => '८',
            '9' => '९',
            other => other,
        })
        .collect()
}

/// Removes consecutive duplicate words (common ASR stutter)
fn deduplicate_consecutive_words(input: &str) -> String {
    let words: Vec<&str> = input.split_whitespace().collect();
    if words.is_empty() {
        return String::new();
    }

    let mut result = Vec::with_capacity(words.len());
    let mut last_word: Option<&str> = None;

    for &word in &words {
        if Some(word) != last_word {
            result.push(word);
            last_word = Some(word);
        }
    }

    result.join(" ")
}

/// Fixes spacing around Nepali punctuation marks
fn clean_punctuation_spacing(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == ' ' {
            // If next char is a punctuation mark that should have no preceding space, skip this space
            if let Some(&next) = chars.peek() {
                if ['।', '?', '!', ',', '.', ';'].contains(&next) {
                    continue;
                }
            }
        }
        result.push(c);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_string() {
        let normalizer = TextNormalizer::new();
        assert_eq!(normalizer.normalize(""), "");
        assert_eq!(normalizer.normalize("   "), "");
    }

    #[test]
    fn test_terminal_danda() {
        let normalizer = TextNormalizer::new();
        assert_eq!(
            normalizer.normalize("म आज कलेज जाँदै छु"),
            "म आज कलेज जाँदै छु।"
        );
        assert_eq!(
            normalizer.normalize("म आज कलेज जाँदै छु।"),
            "म आज कलेज जाँदै छु।"
        );
    }

    #[test]
    fn test_digit_conversion() {
        let normalizer = TextNormalizer::new();
        assert_eq!(
            normalizer.normalize("आज 2081 साल बैशाख 1 गते हो"),
            "आज २०८१ साल बैशाख १ गते हो।"
        );
    }

    #[test]
    fn test_deduplication() {
        let normalizer = TextNormalizer::new();
        assert_eq!(
            normalizer.normalize("म म आज कलेज जाँदै छु"),
            "म आज कलेज जाँदै छु।"
        );
    }

    #[test]
    fn test_punctuation_spacing() {
        let normalizer = TextNormalizer::new();
        assert_eq!(
            normalizer.normalize("नमस्ते , मेरो नाम आदित हो ।"),
            "नमस्ते, मेरो नाम आदित हो।"
        );
    }
}
