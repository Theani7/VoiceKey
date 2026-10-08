"""ASR evaluation pipeline for Nepali WER and CER calculation."""

import json
from pathlib import Path
from typing import List, Dict
import jiwer

def compute_metrics(references: List[str], hypotheses: List[str]) -> Dict[str, float]:
    """Computes Word Error Rate (WER) and Character Error Rate (CER)."""
    wer = jiwer.wer(references, hypotheses)
    cer = jiwer.cer(references, hypotheses)
    return {
        "wer": round(wer, 4),
        "cer": round(cer, 4),
        "accuracy": round(1.0 - wer, 4)
    }

def evaluate_predictions(json_path: Path) -> Dict[str, float]:
    """Reads a JSON file containing [{'reference': '...', 'hypothesis': '...'}] and evaluates."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    references = [item["reference"] for item in data]
    hypotheses = [item["hypothesis"] for item in data]
    metrics = compute_metrics(references, hypotheses)
    print(f"Evaluation Results for {len(data)} samples:")
    print(f"WER: {metrics['wer'] * 100:.2f}%")
    print(f"CER: {metrics['cer'] * 100:.2f}%")
    return metrics

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        evaluate_predictions(Path(sys.argv[1]))
    else:
        # Example test
        refs = ["नमस्ते मेरो नाम आदित हो", "म आज कलेज जाँदै छु"]
        hyps = ["नमस्ते मेरो नाम आदित हो", "म आज कलेज जादै छु"]
        res = compute_metrics(refs, hyps)
        print("Sample Metric Test:", res)
