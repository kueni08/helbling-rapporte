"""Anthropic API Wrapper für das Helbling E-Mail-Verarbeitungssystem."""

import json
import logging
import os
from typing import Optional

import anthropic
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class APIClient:
    """Wrapper für die Anthropic Claude API."""

    def __init__(self, config: dict):
        self.config = config
        api_cfg = config.get("api", {})
        self.model = api_cfg.get("model", "claude-sonnet-4-20250514")
        self.max_tokens = api_cfg.get("max_tokens", 2000)
        self.temperature = api_cfg.get("temperature", 0.3)

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        auth_token = None

        # Unterstütze auch OAuth/Session-Token (Claude Code Umgebung)
        token_file = os.environ.get("CLAUDE_SESSION_INGRESS_TOKEN_FILE")
        if token_file and os.path.exists(token_file):
            session_token = open(token_file).read().strip()
            # JWT/OAuth-Tokens verwenden auth_token (Bearer), klassische Keys api_key
            if session_token.startswith("sk-ant-si-") or session_token.startswith("eyJ"):
                auth_token = session_token
                api_key = None  # Nicht als api_key setzen sonst überschreibt SDK
            elif not api_key:
                api_key = session_token

        if not api_key and not auth_token:
            raise ValueError(
                "ANTHROPIC_API_KEY nicht gesetzt. Bitte .env Datei anlegen."
            )

        if auth_token:
            # Bearer-Token (OAuth/JWT) — NICHT als ANTHROPIC_API_KEY in env setzen
            self.client = anthropic.Anthropic(auth_token=auth_token, api_key="")
        else:
            self.client = anthropic.Anthropic(api_key=api_key)

    def complete(
        self,
        prompt: str,
        system: str = None,
        max_tokens: int = None,
        temperature: float = None,
    ) -> str:
        """Sendet einen Prompt an Claude und gibt die Antwort zurück."""
        kwargs = {
            "model": self.model,
            "max_tokens": max_tokens or self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system

        logger.debug(f"API Call: model={self.model}, max_tokens={kwargs['max_tokens']}")

        response = self.client.messages.create(**kwargs)
        return response.content[0].text

    def complete_json(
        self,
        prompt: str,
        system: str = None,
        max_tokens: int = None,
    ) -> dict:
        """Sendet einen Prompt und parsed die JSON-Antwort."""
        # Erweitere max_tokens für JSON-Ausgaben
        tokens = max_tokens or min(self.max_tokens, 1500)
        text = self.complete(prompt, system=system, max_tokens=tokens)

        # JSON aus der Antwort extrahieren
        return self._extract_json(text)

    def _extract_json(self, text: str) -> dict:
        """Extrahiert JSON aus einem Text (auch wenn er in ```json``` eingebettet ist)."""
        import re

        # Direkt parsen versuchen
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # JSON-Block aus Markdown extrahieren
        patterns = [
            r"```json\s*([\s\S]*?)\s*```",
            r"```\s*([\s\S]*?)\s*```",
            r"(\{[\s\S]*\})",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(1))
                except json.JSONDecodeError:
                    continue

        logger.error(f"Konnte JSON nicht parsen: {text[:200]}")
        raise ValueError(f"Ungültiges JSON in API-Antwort: {text[:200]}")
