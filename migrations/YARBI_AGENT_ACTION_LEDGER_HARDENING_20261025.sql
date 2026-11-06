-- El ledger es append/update controlado por el backend. No necesita borrar,
-- truncar ni administrar referencias desde el rol que usa la API.
revoke delete, truncate, references, trigger on table public.yarbi_agent_actions from service_role;
revoke delete, truncate, references, trigger on table public.yarbi_client_resolutions from service_role;
