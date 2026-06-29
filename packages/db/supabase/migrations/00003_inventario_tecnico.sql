-- Iris — atributos técnicos opcionales por piedra (presentación del redactor)

alter table public.inventario add column if not exists color text;
alter table public.inventario add column if not exists origen text;
alter table public.inventario add column if not exists claridad text;
alter table public.inventario add column if not exists tratamiento text;
