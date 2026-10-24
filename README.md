# FORJA · Luis

App personal de Luis: finanzas, proyectos, disciplina, gym, comidas y peso.
Separada de LUAL: este código no abre ni conoce el contable de la empresa.

- `app/`: PWA estática (Vercel, Root Directory `app`).
- `apps-script/Codigo.gs`: servidor en Google Apps Script. Un solo libro: **LUIS_Personal**.
- `test/`: simulador y pruebas. `TZ=America/Mexico_City node --test test/pruebas.js`
- Ver local: `TZ=America/Mexico_City node test/servidor.js` → http://localhost:8080

## Puesta en marcha (una vez)

1. script.google.com → Nuevo proyecto "FORJA Luis". Pega `Codigo.gs` y `appsscript.json`.
2. Ejecuta `instalar`. Crea LUIS_Personal y la clave (sale en el registro; no la compartas).
3. Ejecuta `migrarDesdeForja`. Copia hábitos, marcas, gym, comidas, peso y Config desde
   FORJA_Personal. No copia las tareas de LUAL. Solo lee el origen; repetirlo no duplica.
4. Ejecuta `instalarPruebas` (copia para el entorno de pruebas).
5. Implementar → Aplicación web (ejecutar como tú, acceso: cualquiera). Copia la URL /exec.
6. Vercel → proyecto nuevo desde este repo, Root Directory `app`.
7. En la app: Ajustes → URL y clave. Los previews (`-git-`) usan pruebas por defecto.

La clave vive en Propiedades del script (`FORJA_CLAVE`). Nunca en el repo.
