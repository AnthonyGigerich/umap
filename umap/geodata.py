import json
import subprocess
import tempfile
from pathlib import Path
from io import BytesIO

from django.core.files.base import ContentFile


def gpkg_to_geojson(file_obj):
    """
    Convert a GeoPackage (file-like) to GeoJSON bytes.

    Preferred path: use Fiona if available (import at runtime).
    Fallback: call ogr2ogr CLI if Fiona is not installed.

    Returns: bytes of GeoJSON UTF-8 encoded.
    Raises: RuntimeError on failure.
    """
    # Try Fiona first (lazy import)
    try:
        import fiona
        from fiona.transform import transform_geom
    except Exception:
        fiona = None

    if fiona:
        # Fiona can read from a file path; write to a temp file
        with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
            tmp.write(file_obj.read())
            tmp.flush()
            tmp_path = tmp.name
        try:
            features = []
            with fiona.Env():
                with fiona.open(tmp_path, layer=0) as src:
                    src_crs = src.crs or {}
                    for rec in src:
                        geom = rec.get("geometry")
                        if geom:
                            # Reproject to EPSG:4326 if needed
                            if src_crs and src_crs.get("init") != "epsg:4326":
                                try:
                                    geom = transform_geom(src_crs, {"init": "epsg:4326"}, geom)
                                except Exception:
                                    pass
                        props = rec.get("properties") or {}
                        features.append({"type": "Feature", "geometry": geom, "properties": props})
            geojson = {"type": "FeatureCollection", "features": features}
            return json.dumps(geojson).encode("utf-8")
        finally:
            try:
                Path(tmp_path).unlink()
            except Exception:
                pass

    # Fallback: use ogr2ogr CLI
    # Write uploaded content to a temp file and call ogr2ogr -f GeoJSON /vsistdout/ in
    # order to capture output.
    with tempfile.NamedTemporaryFile(suffix=".gpkg") as tmp_in:
        tmp_in.write(file_obj.read())
        tmp_in.flush()
        cmd = [
            "ogr2ogr",
            "-f",
            "GeoJSON",
            "/vsistdout/",
            tmp_in.name,
        ]
        try:
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            return proc.stdout
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"ogr2ogr failed: {e.stderr.decode('utf-8', errors='replace')}")

