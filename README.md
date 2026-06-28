# SOS VZLA - Mapa humanitario

Aplicacion web local en Python para registrar y visualizar reportes sobre un mapa mundial: rescate bajo escombros, centros de acopio, albergues, personas vulnerables, voluntarios, atencion medica y otros puntos de ayuda.

No incluye datos reales. Los reportes que agregues se guardan en `data/locations.json`.

## Ejecutar

```powershell
python app.py
```

Abre:

```text
http://127.0.0.1:8000
```

El mapa usa teselas de OpenStreetMap mediante internet. El servidor y los reportes funcionan localmente.

## Proteger cambios con clave

Opcionalmente puedes exigir una clave para crear, editar o borrar reportes:

```powershell
$env:SOSVZLA_TOKEN="pon-una-clave-larga"
python app.py
```

En la web, escribe esa clave en el campo "Clave administrativa".

## Archivos

- `app.py`: servidor Python con API JSON.
- `static/index.html`: interfaz del mapa.
- `static/styles.css`: estilos.
- `static/app.js`: logica del mapa, filtros y formulario.
- `data/locations.json`: almacenamiento local.

## Nota operativa

Para uso real en una emergencia, verifica los reportes antes de mover personas o recursos. Evita publicar nombres, telefonos, documentos, imagenes sensibles o datos que puedan identificar a ninos, victimas o personas mayores vulnerables.
