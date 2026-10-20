\set ON_ERROR_STOP on
-- Run only as the backup operator, on the disposable CI databases, while no writes occur.
SELECT format(
  'SELECT %L || ''|'' || count(*) || ''|'' || md5(coalesce(string_agg(md5(row_to_json(t)::text), '''' ORDER BY md5(row_to_json(t)::text)), '''')) FROM public.%I t;',
  tablename, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
