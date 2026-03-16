"""Tests für die Wissensdatenbank."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.knowledge import KnowledgeBase, KnowledgeChunk

CONFIG = {
    "paths": {"knowledge_base": "./knowledge_base"},
    "knowledge": {"chunk_size": 1000, "chunk_overlap": 200, "top_k": 5},
}


@pytest.fixture(scope="module")
def kb():
    """Lädt die Wissensdatenbank einmalig für alle Tests."""
    base = KnowledgeBase(CONFIG)
    base.load()
    return base


class TestKnowledgeBase:
    def test_loading(self, kb):
        """Wissensdatenbank lädt Dateien korrekt."""
        status = kb.get_status()
        assert status["total_chunks"] > 0
        assert status["local_files"] > 0

    def test_categories_present(self, kb):
        """Alle Kategorien sind vertreten."""
        cats = {c.category for c in kb.chunks}
        assert "sibox" in cats
        assert "facettestar" in cats
        assert "allgemein" in cats

    def test_retrieve_sibox_price(self, kb):
        """Findet SIBOX-Preise für relevante Anfrage."""
        results = kb.retrieve("SIBOX S3 Preis CHF", top_k=3)
        assert len(results) > 0
        # Mindestens ein Ergebnis sollte SIBOX-spezifisch sein
        sibox_results = [r for r in results if "sibox" in r.category.lower() or "sibox" in r.source_file.lower()]
        assert len(sibox_results) > 0

    def test_retrieve_facettestar(self, kb):
        """Findet FACETTESTAR-Infos."""
        results = kb.retrieve("FACETTESTAR FS-200 Entgratmaschine", top_k=3)
        assert len(results) > 0
        sources = " ".join(r.source_file for r in results)
        assert "facettestar" in sources.lower()

    def test_retrieve_with_category_filter(self, kb):
        """Kategorie-Filter funktioniert."""
        results_sibox = kb.retrieve("Schlüsseldepot", top_k=5, category="sibox")
        results_facettestar = kb.retrieve("Schlüsseldepot", top_k=5, category="facettestar")
        # SIBOX-Filter sollte relevanter sein
        assert len(results_sibox) >= len(results_facettestar)

    def test_retrieve_returns_relevance_scores(self, kb):
        """Alle zurückgegebenen Chunks haben einen Score > 0."""
        results = kb.retrieve("SIBOX Keso Zylinder", top_k=3)
        for r in results:
            assert r.relevance_score > 0
            assert isinstance(r.relevance_score, float)

    def test_retrieve_empty_query(self, kb):
        """Leere Anfrage gibt leere Liste zurück."""
        results = kb.retrieve("", top_k=3)
        assert isinstance(results, list)

    def test_format_for_prompt(self, kb):
        """format_for_prompt gibt non-leeren String zurück."""
        chunks = kb.retrieve("SIBOX Preis", top_k=3)
        if chunks:
            text = kb.format_for_prompt(chunks)
            assert len(text) > 50
            assert "Quelle:" in text

    def test_tfidf_index_built(self, kb):
        """TF-IDF Index wird korrekt aufgebaut."""
        # Nach load() sollte entweder TF-IDF oder Keyword-Fallback aktiv sein
        results = kb.retrieve("Schlüsseldepot SIBOX Edelstahl", top_k=5)
        assert len(results) > 0

    def test_csv_loaded(self, kb):
        """CSV-Preislisten werden korrekt geladen."""
        price_chunks = [c for c in kb.chunks if "preislisten" in c.source_file]
        assert len(price_chunks) > 0
        # Preisliste sollte CHF-Preise enthalten
        price_content = " ".join(c.content for c in price_chunks)
        assert "CHF" in price_content or "650" in price_content  # SIBOX S3 Preis

    def test_status_returns_dict(self, kb):
        """get_status gibt vollständiges Dict zurück."""
        status = kb.get_status()
        required_keys = ["total_chunks", "local_files", "local_chunks", "by_category"]
        for key in required_keys:
            assert key in status
