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
│ └──────┘└──────────┘  │                                        │ NVR [NVR-01 ▾] CH 05│
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
- **Panel lateral** con dos pestañas: *Cámaras* (filtros, estadísticas y listado del plano) y *Topología* (ver § 5.3).
- **Resaltar un NVR** (desde la Topología, la ficha de una cámara o «Ver en el plano» de la pantalla de NVR): sus cámaras llevan un anillo turquesa y las demás se atenúan (también sus conos); el plano se encuadra en ellas. Una barra flotante indica cuántas hay en este plano y en otros, permite **«Mostrar solo estas»** y quitar el resaltado.
- **Ficha** (pestañas): en la cabecera, **NVR asignado, canal y estado** (el estado es el manual: operativa, averiada o mantenimiento; la comprobación real de conexión queda para la integración ONVIF). *Ficha* (todos los datos técnicos; el desplegable de NVR muestra la ocupación y desactiva los completos, y el canal es «Automático» o uno libre), *Cobertura* (orientación, ángulo y alcance con vista previa en directo), *Adjuntos* (fotos con miniatura, botón «Foto» que abre la cámara del móvil, documentos descargables) e *Historial* (quién cambió qué y cuándo).
- **Responsive**: en escritorio (≥1024 px) tres columnas; en tablet el listado es un panel superpuesto (botón ☰) y la ficha un panel lateral; en móvil la ficha ocupa toda la pantalla.

## 4. Configuración del plano (modal ⚙)
Nombre, **ancho real en metros** (escala) y **sustituir imagen** (PNG/JPG/PDF). Las cámaras conservan su posición y la versión anterior queda en el histórico. Aviso si cambia la proporción.

## 5. NVR — `/projects/:id/nvrs`
Botón **NVR** de la barra del plano.

### 5.1 Listado y panel resumen
```
┌ ‹ Polígono Norte / Grabadores (NVR) ─────────────────────────────── [+ Nuevo NVR] ┐
│ ┌ NVR ┐ ┌ Cámaras ┐ ┌ Cámaras sin asignar ┐ ┌ Canales libres          ┐           │
│ │  3  │ │   48    │ │         6           │ │ 7 de 36 · 1 sin definir │           │
│ Nombre      Marca/modelo   IP          Ubicación   Canales Cámaras Libres Ocup. Estado │
│ NVR Oficina Hikvision …    10.0.0.10   Rack SATE      16      12      4  ███░ 75% Disponible │
│ NVR Almacén Dahua          10.0.0.11   Almacén         4       4      0  ████100% Completo   │
│ Antiguo     —              —           —               —       3      —  ──── —  Capacidad sin definir │
│ Cámaras sin NVR (6)                                             [Ver en el plano] │
│ [✓ Todas] 2 seleccionadas → [Elegir NVR… ▾] [Asignar]                             │
└──────────────────────────────────────────────────────────────────────────────────┘
```
- **Estado**: *Disponible*, *Completo*, *Sobrecapacidad* (NVR antiguos con más cámaras que canales) o *Capacidad sin definir* (NVR anteriores a esta versión sin nº de canales: no se valida hasta que alguien lo rellene).
- **Cámaras sin NVR**: asignación rápida en bloque; el desplegable desactiva los NVR completos y avisa si se eligen más cámaras que canales libres.

### 5.2 Detalle — `/projects/:id/nvrs/:nvrId`
Datos del equipo, **Canales / Cámaras / Libres** con barra de ocupación, y las cámaras por canal (`CH 01`…) con tipo, estado, IP y plano. Acciones por cámara: *ver en el plano*, *mover a otro NVR* (conserva el canal si está libre en el destino) y *desasociar*. **Asociar cámaras** abre un buscador con las cámaras sin NVR primero; las de otro NVR se marcan «se moverá desde…».
- **Validaciones**: aviso ámbar al llegar al **80 %**; al llenarse, error rojo y botón «Asociar cámaras» desactivado. El servidor y la base de datos lo garantizan también (409), incluso con varios técnicos a la vez.
- Lectura: ve todo sin botones de edición.

### 5.3 Topología (pestaña del panel lateral del plano)
```
▾ 🗂 Polígono Norte
  ▾ ▤ NVR-01            12/16 ███░
      ● CH 01 CAM-001 Recepción
      ▬ CH 02 CAM-002 Pasillo
  ▸ ▤ NVR-02             4/4  ████
  ▾ ⚡ Sin NVR              2
```
Nodos que se expanden y contraen (y «Expandir/Contraer todo»). Pulsar una **cámara** la centra en el plano y abre su ficha (si está en otro plano, cambia de plano); pulsar un **NVR** lo resalta en el plano (otra pulsación lo quita).

## 6. Usuarios — `/admin/users` (admin)
Tabla con rol, último acceso y estado; alta, edición, cambio de contraseña y activar/desactivar.

## 7. Auditoría — `/admin/audit` (admin)
Registro cronológico: fecha, usuario, acción (alta, modificación, baja, acceso, exportación), entidad, proyecto y campos modificados.
