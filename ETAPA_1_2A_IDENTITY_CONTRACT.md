# Contrato de identidad Live v2 — Etapa 1.2A

## Componentes admitidos

Cada componente conserva tipo y valor con codificación longitud + UTF-16 hexadecimal:

| Tipo | Prefijo | Regla |
| --- | --- | --- |
| `undefined` | `u` | valor ausente explícito |
| `null` | `n` | nulo explícito |
| `string` | `s` | se conserva sin recorte |
| `number` | `d` | solo entero finito y seguro |
| `boolean` | `b` | se conserva como valor booleano |
| `bigint` | `g` | se conserva sin conversión a número |

Objetos, símbolos, funciones, `NaN`, infinitos y números no seguros se rechazan. No se aplica `String(value)` a valores de tipo arbitrario.

## Tupla

`role` debe ser exactamente `user` o `assistant`. La tupla requiere que `role`, `liveSessionId` y `turnId` sean codificables. Si uno no lo es, las funciones de clave devuelven `null` y el borrador/finalización no continúa.

## Garantías comprobadas

- `1` y `"1"` producen IDs distintos.
- Unicode y componentes largos no se recortan.
- Ausente, nulo y cadena vacía mantienen semánticas distintas.
- Un rol no autorizado no se degrada silenciosamente a `assistant`.

## Pendientes

La coordinación de una misma tupla entre pestañas o procesos independientes queda fuera de esta etapa y requiere la estrategia de concurrencia de 1.2B.
