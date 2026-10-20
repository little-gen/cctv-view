# Pantallas principales

Tema oscuro tipo GIS: plano a pantalla completa, panel lateral con listado y filtros, y ficha a la derecha.

## 1. Inicio de sesión — `/login`
```
┌─────────────────────────────┐
│ ◉ PlanosCámaras             │
│   Documentación de CCTV     │
│ Correo     [______________] │
│ Contraseña [______________] │
│ [      Iniciar sesión     ] │
└─────────────────────────────┘
```

## 2. Proyectos — `/`
Tarjetas por ubicación con nº de planos, cámaras y averiadas. «Nuevo proyecto» (solo admin).
```
┌ ◉ PlanosCámaras   Usuarios  Auditoría ─────────────── Ana · Administrador ⎋ ┐
│ Proyectos                                               [+ Nuevo proyecto]   │
│ ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐      │
│ │ ▣ Polígono Norte    │ │ ▣ Plataforma Sur    │ │ ▣ Almacén Central   │      │
│ │ Cliente · Dirección │ │ …                   │ │ …                   │      │
│ │ ▤ 3 planos ◉ 48 cám │ │ ▤ 1 plano ◉ 12 cám  │ │ ▤ 2 planos ◉ 30 cám │      │
│ │ ⚠ 2 averiadas       │ │                     │ │ ⚠ 1 averiada        │      │
│ └─────────────────────┘ └─────────────────────┘ └─────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 3. Espacio de trabajo (editor) — `/projects/:id/plans/:planId`
```
┌ ‹ ☰ Polígono Norte / [Nave 1 ▾] + ⚙ ─────────────────── ▤ NVR  ◫ Capas  ⤓ Exportar ┐
├───────────────────────┬────────────────────────────────────────┬────────────────────┤
│ 🔍 nombre, código, IP │ ┌Añadir┐                               │ ● Acceso principal │
│ (●Operativa)(●Averia.)│ │● Domo│     ◢◣ cono                   │ CAM-001·Domo·●Oper.│
│ (D Domo)(B Bullet)…   │ │▬ Bull│   ●──▶  ╲                     │ Ficha│Cobertura│…  │
│ [Fabricante…     ▾]   │ │⬡ PTZ │          ╲                    │ Tipo [Domo ▾]      │
│ ┌──────┐┌──────────┐  │ │◆ Térm│      ◼ LPR                    │ Estado [Operat. ▾] │
│ │Total ││Cobertura │  │ │■ LPR │                               │ Marca  [Hikvision] │
│ │  48  ││   73%    │  │ └──────┘           PLANO               │ IP [192.168.1.64]  │
│ └──────┘└──────────┘  │                                        │ NVR [NVR-01     ▾] │
│ Operat. 45 · Aver. 2  │                                        │ Ubicación física   │
│ Por tipo  D ████ 20   │                                        │ Observaciones      │
│           B ██   10 … │                                [+][-][⤢]│ [Eliminar][Guardar]│
│ ─────────────────────│ ├─10 m─┤                                │                    │
│ ● Acceso princ CAM-001│                                        │                    │
│ ▬ Muelle 3     CAM-002│                                        │                    │
└───────────────────────┴────────────────────────────────────────┴────────────────────┘
```
- **Plano**: rueda = zoom en el cursor, arrastrar = desplazar, pellizco en táctil, botones +/−/encajar, barra de escala en metros.
- **Añadir cámara**: arrastrar un tipo de la paleta al plano (escritorio) o tocar el tipo y luego el plano (tablet/móvil). Se crea con código `CAM-xxx`, ángulo por defecto según tipo y se abre su ficha.
- **Mover / rotar**: arrastrar el icono; al seleccionarlo aparece un tirador blanco para girar el cono.
- **Iconos**: forma + letra por tipo (● D domo, ▬ B bullet, ⬡ PTZ, ◆ T térmica, ■ LPR); borde = estado (verde operativa, rojo averiada, ámbar mantenimiento). Los conos de cámaras no operativas se dibujan discontinuos y más tenues.
- **Capas**: conos, etiquetas, **mapa de calor** (nº de cámaras que ven cada zona, rampa azul) o **zonas sin cobertura** (rojo), con opción «solo cámaras operativas».
- **Exportar**: plano con cámaras en PDF A3, informe técnico en PDF y inventario en Excel.
- **Ficha** (pestañas): *Ficha* (todos los datos técnicos), *Cobertura* (orientación, ángulo y alcance con vista previa en directo), *Adjuntos* (fotos con miniatura, botón «Foto» que abre la cámara del móvil, documentos descargables) e *Historial* (quién cambió qué y cuándo).
- **Responsive**: en escritorio (≥1024 px) tres columnas; en tablet el listado es un panel superpuesto (botón ☰) y la ficha un panel lateral; en móvil la ficha ocupa toda la pantalla.

## 4. Configuración del plano (modal ⚙)
Nombre, **ancho real en metros** (escala) y **sustituir imagen** (PNG/JPG/PDF). Las cámaras conservan su posición y la versión anterior queda en el histórico. Aviso si cambia la proporción.

## 5. NVR (modal)
Listado con IP, canales y nº de cámaras asociadas; alta rápida.

## 6. Usuarios — `/admin/users` (admin)
Tabla con rol, último acceso y estado; alta, edición, cambio de contraseña y activar/desactivar.

## 7. Auditoría — `/admin/audit` (admin)
Registro cronológico: fecha, usuario, acción (alta, modificación, baja, acceso, exportación), entidad, proyecto y campos modificados.
