from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "locations.json"

CATEGORIES = {
    "rescate_escombros": {
        "label": "Rescate bajo escombros",
        "color": "#d92d20",
    },
    "persona_viva": {
        "label": "Persona viva localizada",
        "color": "#027a48",
    },
    "fallecidos": {
        "label": "Persona fallecida",
        "color": "#344054",
    },
    "centro_acopio": {
        "label": "Centro de acopio",
        "color": "#1570ef",
    },
    "obstruccion": {
        "label": "Obstruccion al auxilio",
        "color": "#b42318",
    },
    "voluntarios": {
        "label": "Voluntarios disponibles",
        "color": "#0e9384",
    },
    "sin_techo": {
        "label": "Personas sin techo",
        "color": "#b54708",
    },
    "albergue": {
        "label": "Albergue o refugio",
        "color": "#6941c6",
    },
    "ninez": {
        "label": "Ninez sin tutor",
        "color": "#c11574",
    },
    "mayores": {
        "label": "Personas mayores",
        "color": "#175cd3",
    },
    "medico": {
        "label": "Atencion medica",
        "color": "#c01048",
    },
    "otro": {
        "label": "Otro reporte",
        "color": "#475467",
    },
}

URGENCY = {"critica", "alta", "media", "baja"}
STATUS = {"sin_verificar", "verificado", "en_atencion", "resuelto"}
LOCATION_QUALITY = {"exacta", "aproximada", "por_confirmar"}
WRITABLE_METHODS = {"POST", "PATCH", "DELETE"}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_data_file() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text("[]\n", encoding="utf-8")


def load_locations() -> list[dict]:
    ensure_data_file()
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("El archivo de datos debe contener una lista JSON.")
    return data


def save_locations(locations: list[dict]) -> None:
    ensure_data_file()
    fd, temp_name = tempfile.mkstemp(prefix="locations-", suffix=".json", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(locations, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_name, DATA_FILE)
    finally:
        if os.path.exists(temp_name):
            os.remove(temp_name)


def require_text(payload: dict, field: str, max_len: int) -> str:
    value = str(payload.get(field, "")).strip()
    if not value:
        raise ValueError(f"Falta el campo '{field}'.")
    if len(value) > max_len:
        raise ValueError(f"El campo '{field}' no debe superar {max_len} caracteres.")
    return value


def optional_text(payload: dict, field: str, max_len: int) -> str:
    value = str(payload.get(field, "") or "").strip()
    if len(value) > max_len:
        raise ValueError(f"El campo '{field}' no debe superar {max_len} caracteres.")
    return value


def parse_coordinate(payload: dict, field: str, minimum: float, maximum: float) -> float:
    try:
        value = float(payload.get(field))
    except (TypeError, ValueError):
        raise ValueError(f"El campo '{field}' debe ser un numero.") from None
    if value < minimum or value > maximum:
        raise ValueError(f"El campo '{field}' esta fuera de rango.")
    return round(value, 6)


def parse_choice(payload: dict, field: str, allowed: set[str], default: str | None = None) -> str:
    value = str(payload.get(field, default or "")).strip()
    if value not in allowed:
        allowed_values = ", ".join(sorted(allowed))
        raise ValueError(f"El campo '{field}' debe ser uno de: {allowed_values}.")
    return value


def parse_needs(payload: dict) -> list[str]:
    raw_needs = payload.get("needs", [])
    if isinstance(raw_needs, str):
        values = [part.strip() for part in raw_needs.split(",")]
    elif isinstance(raw_needs, list):
        values = [str(part).strip() for part in raw_needs]
    else:
        raise ValueError("El campo 'needs' debe ser una lista o texto separado por comas.")

    needs: list[str] = []
    for value in values:
        if not value:
            continue
        if len(value) > 40:
            raise ValueError("Cada necesidad debe tener 40 caracteres o menos.")
        if value not in needs:
            needs.append(value)
    if len(needs) > 12:
        raise ValueError("No agregues mas de 12 necesidades en un reporte.")
    return needs


def build_location(payload: dict, existing: dict | None = None) -> dict:
    created_at = existing.get("created_at") if existing else now_iso()
    report_id = existing.get("id") if existing else str(uuid.uuid4())
    category = parse_choice(payload, "category", set(CATEGORIES))

    return {
        "id": report_id,
        "created_at": created_at,
        "updated_at": now_iso(),
        "title": require_text(payload, "title", 140),
        "category": category,
        "category_label": CATEGORIES[category]["label"],
        "urgency": parse_choice(payload, "urgency", URGENCY, "media"),
        "status": parse_choice(payload, "status", STATUS, "sin_verificar"),
        "location_quality": parse_choice(payload, "location_quality", LOCATION_QUALITY, "por_confirmar"),
        "lat": parse_coordinate(payload, "lat", -90, 90),
        "lng": parse_coordinate(payload, "lng", -180, 180),
        "address": optional_text(payload, "address", 180),
        "city": optional_text(payload, "city", 80),
        "country": optional_text(payload, "country", 80),
        "description": optional_text(payload, "description", 1200),
        "needs": parse_needs(payload),
        "capacity": optional_text(payload, "capacity", 80),
        "source": optional_text(payload, "source", 180),
    }


class CrisisMapHandler(SimpleHTTPRequestHandler):
    server_version = "SOSVZLA/1.0"

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        parsed_path = urlparse(path).path
        safe_path = unquote(parsed_path).lstrip("/")

        if not safe_path:
            safe_path = "index.html"
        if safe_path.startswith("static/"):
            safe_path = safe_path[len("static/") :]

        resolved = (STATIC_DIR / safe_path).resolve()
        static_root = STATIC_DIR.resolve()
        if resolved == static_root or static_root in resolved.parents:
            return str(resolved)
        return str(STATIC_DIR / "404.html")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self.send_json({"ok": True, "time": now_iso()})
        if parsed.path == "/api/categories":
            return self.send_json({"categories": CATEGORIES})
        if parsed.path == "/api/locations":
            try:
                return self.send_json({"locations": load_locations()})
            except Exception as exc:
                return self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/locations":
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
        if not self.has_write_access(parsed):
            return self.send_error_json(HTTPStatus.UNAUTHORIZED, "Clave administrativa incorrecta o ausente.")
        try:
            payload = self.read_json_body()
            locations = load_locations()
            new_location = build_location(payload)
            locations.append(new_location)
            save_locations(locations)
            return self.send_json({"location": new_location}, HTTPStatus.CREATED)
        except ValueError as exc:
            return self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            return self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        report_id = self.extract_report_id(parsed.path)
        if not report_id:
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
        if not self.has_write_access(parsed):
            return self.send_error_json(HTTPStatus.UNAUTHORIZED, "Clave administrativa incorrecta o ausente.")
        try:
            payload = self.read_json_body()
            locations = load_locations()
            for index, location in enumerate(locations):
                if location.get("id") == report_id:
                    updated = build_location({**location, **payload}, existing=location)
                    locations[index] = updated
                    save_locations(locations)
                    return self.send_json({"location": updated})
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Reporte no encontrado.")
        except ValueError as exc:
            return self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            return self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        report_id = self.extract_report_id(parsed.path)
        if not report_id:
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")
        if not self.has_write_access(parsed):
            return self.send_error_json(HTTPStatus.UNAUTHORIZED, "Clave administrativa incorrecta o ausente.")
        try:
            locations = load_locations()
            next_locations = [location for location in locations if location.get("id") != report_id]
            if len(next_locations) == len(locations):
                return self.send_error_json(HTTPStatus.NOT_FOUND, "Reporte no encontrado.")
            save_locations(next_locations)
            return self.send_json({"deleted": report_id})
        except Exception as exc:
            return self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 32_000:
            raise ValueError("El cuerpo de la solicitud es demasiado grande.")
        raw_body = self.rfile.read(length).decode("utf-8") if length else "{}"
        payload = json.loads(raw_body)
        if not isinstance(payload, dict):
            raise ValueError("El cuerpo de la solicitud debe ser un objeto JSON.")
        return payload

    def has_write_access(self, parsed) -> bool:
        expected = os.environ.get("SOSVZLA_TOKEN", "").strip()
        if not expected:
            return True
        query_token = parse_qs(parsed.query).get("token", [""])[0]
        header_token = self.headers.get("X-Admin-Token", "")
        return expected in {query_token, header_token}

    @staticmethod
    def extract_report_id(path: str) -> str | None:
        prefix = "/api/locations/"
        if not path.startswith(prefix):
            return None
        report_id = path[len(prefix) :].strip("/")
        return report_id or None

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status)


def run() -> None:
    ensure_data_file()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), CrisisMapHandler)
    print(f"SOS VZLA mapa activo en http://{host}:{port}")
    print("Ctrl+C para detener el servidor.")
    server.serve_forever()


if __name__ == "__main__":
    run()
