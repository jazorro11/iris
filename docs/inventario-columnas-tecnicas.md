# Inventario — guía de captura de columnas técnicas

Referencia para quien carga el inventario de Méraldi. Desde la feature *redactor con
criterio Méraldi*, Iris (el bot) presenta cada piedra con **datos técnicos**. Cuanto
mejor llenes estas columnas, más rica y variada es la conversación: Iris aporta un
ángulo técnico **nuevo** de la misma piedra en cada turno (color → origen → claridad →
tratamiento → valor), en lugar de hablar solo en términos generales.

## Cómo las usa Iris (cascada)

Por cada atributo, Iris usa **el primero que exista**:

1. La **columna estructurada** (`color`, `origen`, `claridad`, `tratamiento`).
2. Si está vacía → el texto libre de **`notas`**.
3. Si no hay nada → el **conocimiento general de la guía** (p. ej. "las esmeraldas
   colombianas de Muzo destacan por su verde intenso").

Todas son **opcionales y nullable**: no hace falta llenarlas todas ni de golpe; Iris
degrada con gracia campo por campo.

> El **match** (qué piedra se recomienda) sigue usando solo **forma + peso + precio/ct**.
> Estas columnas son de **presentación**. Cablearlas al filtrado de match quedó como
> fase futura (ver `docs/superpowers/specs/2026-06-29-iris-redactor-criterio-meraldi-design.md` §7).

## Columnas

### `color`
Tono + saturación. Es el factor que más pesa en el valor de una esmeralda.

Valores recomendados: `verde vívido`, `verde intenso`, `verde medio`, `verde claro`,
`verde azulado`.

### `origen`
Mina/zona + país. Aporta contexto y reputación (no determina por sí solo el valor).

Valores recomendados: `Muzo (Colombia)`, `Coscuez (Colombia)`, `Chivor (Colombia)`,
`La Pita/Maripí (Colombia)`, `Gachalá (Colombia)`, `Kafubu/Kagem (Zambia)`,
`Bahía (Brasil)`, `Minas Gerais (Brasil)`.

### `claridad`
Lectura del "jardín" interno y la transparencia. Las inclusiones naturales no son un
defecto absoluto si la piedra conserva transparencia y brillo.

Valores recomendados: `limpia`, `jardín leve`, `inclusiones aceptables`,
`jardín visible pero transparente`.

### `tratamiento`
La escala comercial de 5 niveles (menos tratamiento, con buena calidad, suele significar
mayor valor). Hay que **declararlo** siempre.

Valores: `sin tratamiento`, `insignificante`, `menor`, `moderado`, `significativo`.

## Columnas ya existentes que conviene aprovechar

### `media_url`
URL pública de **una** foto o video real de la piedra. Es lo que Iris **envía por
Telegram** cuando el cliente pide fotos (con fallback a solo texto si la URL falla).

### `notas`
Texto libre para lo que no cabe en las columnas: brillo, certificado/laboratorio
(GIA, Gübelin, SSEF, AGL, Guild), características especiales (`trapiche`, `macla`,
`canutillo`, `matriz`, `doble terminación`), o por qué la pieza es especial.

## Reglas que Iris ya respeta (no hace falta que las repitas en notas)

- No promete rentabilidad: comunica las esmeraldas como **belleza, colección y
  patrimonio tangible**, aclarando que no son activos líquidos.
- Cotiza el precio de la **piedra** (por quilate y total = peso × precio/ct); el precio
  de la **joya terminada** (montaje, metal, talla) lo afina un asesor.
- No inventa atributos: si una columna está vacía, habla en términos generales de la
  guía, no se inventa un dato concreto de esa piedra.
