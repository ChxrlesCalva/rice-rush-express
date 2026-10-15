
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.riders') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'riders'
         AND column_name = 'id'
         AND udt_name = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'id'
         AND udt_name = 'int8'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'rider_id'
         AND udt_name = 'uuid'
         AND is_nullable = 'YES'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'order_type'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'status'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'riders'
         AND column_name = 'status'
     ) THEN
    RAISE EXCEPTION
      'Required rider/order schema is missing or has incompatible types. Expected riders.id uuid, orders.id bigint, orders.rider_id uuid, and order_type/status columns.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('riders', 'full_name'),
      ('riders', 'phone'),
      ('riders', 'email'),
      ('riders', 'vehicle_type'),
      ('riders', 'plate_number'),
      ('riders', 'created_at')
    ) AS required_column(table_name, column_name)
    LEFT JOIN information_schema.columns AS actual_column
      ON actual_column.table_schema = 'public'
      AND actual_column.table_name = required_column.table_name
      AND actual_column.column_name = required_column.column_name
    WHERE actual_column.column_name IS NULL
  ) THEN
    RAISE EXCEPTION
      'The riders table is missing one or more expected rider profile columns.';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION
      'Required authorization function public.is_admin() is missing.';
  END IF;

  IF to_regclass('public.admin_users') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'admin_users'
         AND column_name = 'user_id'
         AND udt_name = 'uuid'
     ) THEN
    RAISE EXCEPTION
      'Expected public.admin_users(user_id uuid) authorization schema was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS auth_function
    WHERE auth_function.oid = to_regprocedure('public.is_admin()')
      AND auth_function.prorettype = 'boolean'::regtype
      AND auth_function.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(auth_function.proconfig) AS function_setting(setting)
        WHERE function_setting.setting LIKE 'search_path=pg_catalog%'
          AND position('$user' IN function_setting.setting) = 0
          AND position('pg_temp' IN function_setting.setting) = 0
      )
  ) THEN
    RAISE EXCEPTION
      'public.is_admin() must be an existing SECURITY DEFINER boolean function with a fixed search_path beginning with pg_catalog and excluding $user/pg_temp. Inspect its definition; this migration will not replace it.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'The authenticated role must be able to execute public.is_admin() for Rider Management RLS policies.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid = 'public.orders'::regclass
      AND foreign_key.confrelid = 'public.riders'::regclass
      AND foreign_key.conkey = ARRAY[(
        SELECT column_info.attnum
        FROM pg_catalog.pg_attribute AS column_info
        WHERE column_info.attrelid = 'public.orders'::regclass
          AND column_info.attname = 'rider_id'
          AND NOT column_info.attisdropped
      )]::smallint[]
      AND foreign_key.confkey = ARRAY[(
        SELECT column_info.attnum
        FROM pg_catalog.pg_attribute AS column_info
        WHERE column_info.attrelid = 'public.riders'::regclass
          AND column_info.attname = 'id'
          AND NOT column_info.attisdropped
      )]::smallint[]
  ) THEN
    RAISE EXCEPTION
      'Expected foreign key public.orders(rider_id) -> public.riders(id) was not found. No foreign key will be created or changed by this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'riders'
      AND policy.permissive = 'RESTRICTIVE'
      AND policy.policyname NOT IN (
        'riders_admin_manage_is_admin_v1',
        'riders_admin_only_is_admin_v1'
      )
  ) THEN
    RAISE EXCEPTION
      'An additional restrictive policy exists on public.riders. Review it before applying this migration; it may deny rider access to admins.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS protected_table
    WHERE protected_table.oid IN (
      'public.riders'::regclass,
      'public.orders'::regclass
    )
      AND protected_table.relforcerowsecurity
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS executing_role
        WHERE executing_role.rolname = current_user
          AND executing_role.rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'RLS is FORCE-enabled on riders or orders and the migration role does not bypass RLS. SECURITY DEFINER synchronization/assignment functions may not work safely.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.riders
    WHERE status IS NULL
       OR status NOT IN ('Available', 'On Delivery', 'Inactive')
  ) THEN
    RAISE EXCEPTION
      'Update existing riders.status values to Available, On Delivery, or Inactive before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT assigned_order.rider_id
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id IS NOT NULL
      AND assigned_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
    GROUP BY assigned_order.rider_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'A rider has more than one active delivery. Resolve these assignments before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id IS NOT NULL
      AND assigned_order.order_type IS DISTINCT FROM 'delivery'
  ) THEN
    RAISE EXCEPTION
      'A rider is assigned to a non-delivery order. Resolve these assignments before applying this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_delivery_per_rider_v1
  ON public.orders (rider_id)
  WHERE rider_id IS NOT NULL
    AND status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery');

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  existing_policy record;
BEGIN
  SELECT policy.permissive, policy.cmd, policy.roles, policy.qual, policy.with_check
  INTO existing_policy
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'riders'
    AND policy.policyname = 'riders_admin_manage_is_admin_v1';

  IF FOUND THEN
    IF existing_policy.permissive <> 'PERMISSIVE'
       OR existing_policy.cmd <> 'ALL'
       OR existing_policy.roles <> ARRAY['authenticated']::name[]
       OR position('is_admin' IN coalesce(existing_policy.qual, '')) = 0
       OR position('is_admin' IN coalesce(existing_policy.with_check, '')) = 0 THEN
      RAISE EXCEPTION
        'Policy riders_admin_manage_is_admin_v1 already exists with unexpected settings. Review it manually; this migration will not replace it.';
    END IF;
  ELSE
    CREATE POLICY riders_admin_manage_is_admin_v1
      ON public.riders
      AS PERMISSIVE
      FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;

  SELECT policy.permissive, policy.cmd, policy.roles, policy.qual, policy.with_check
  INTO existing_policy
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'riders'
    AND policy.policyname = 'riders_admin_only_is_admin_v1';

  IF FOUND THEN
    IF existing_policy.permissive <> 'RESTRICTIVE'
       OR existing_policy.cmd <> 'ALL'
       OR existing_policy.roles <> ARRAY['authenticated']::name[]
       OR position('is_admin' IN coalesce(existing_policy.qual, '')) = 0
       OR position('is_admin' IN coalesce(existing_policy.with_check, '')) = 0 THEN
      RAISE EXCEPTION
        'Policy riders_admin_only_is_admin_v1 already exists with unexpected settings. Review it manually; this migration will not replace it.';
    END IF;
  ELSE
    CREATE POLICY riders_admin_only_is_admin_v1
      ON public.riders
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.riders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.riders TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_rider_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.status IS NULL
     OR NEW.status NOT IN ('Available', 'On Delivery', 'Inactive') THEN
    RAISE EXCEPTION 'Rider status must be Available, On Delivery, or Inactive.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'On Delivery' AND NOT EXISTS (
    SELECT 1
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id = NEW.id
      AND assigned_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
  ) THEN
    RAISE EXCEPTION 'A rider can be On Delivery only while assigned to an active delivery.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('Available', 'Inactive') AND EXISTS (
    SELECT 1
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id = NEW.id
      AND assigned_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
  ) THEN
    RAISE EXCEPTION 'A rider with an active delivery cannot be marked Available or Inactive.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_rider_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS riders_guard_status_v1 ON public.riders;
CREATE TRIGGER riders_guard_status_v1
  BEFORE INSERT OR UPDATE OF status ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_rider_status();

CREATE OR REPLACE FUNCTION public.guard_order_rider_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  rider_status text;
BEGIN
  IF (
    (TG_OP = 'INSERT' AND NEW.rider_id IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.rider_id IS DISTINCT FROM OLD.rider_id)
  ) AND public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only authorized administrators can assign or remove delivery riders.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.rider_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.order_type IS DISTINCT FROM 'delivery' THEN
    RAISE EXCEPTION 'Riders can only be linked to delivery orders.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS NULL
     OR NEW.status NOT IN ('confirmed', 'preparing', 'ready', 'out_for_delivery') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Riders can only be assigned to active delivery orders.'
        USING ERRCODE = '23514';
    ELSIF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
      RAISE EXCEPTION 'Riders can only be assigned to active delivery orders.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT rider.status
  INTO rider_status
  FROM public.riders AS rider
  WHERE rider.id = NEW.rider_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected rider does not exist.'
      USING ERRCODE = '23503';
  END IF;

  IF rider_status = 'Inactive' THEN
    RAISE EXCEPTION 'Inactive riders cannot be assigned to active deliveries.'
      USING ERRCODE = '23514';
  END IF;

  IF rider_status <> 'Available'
     AND (TG_OP = 'INSERT' OR NEW.rider_id IS DISTINCT FROM OLD.rider_id) THEN
    RAISE EXCEPTION 'Only Available riders can receive a new active delivery.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders AS other_order
    WHERE other_order.rider_id = NEW.rider_id
      AND other_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
      AND other_order.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'This rider already has an active delivery.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_order_rider_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_guard_rider_assignment_v1 ON public.orders;
CREATE TRIGGER orders_guard_rider_assignment_v1
  BEFORE INSERT OR UPDATE OF rider_id, status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_rider_assignment();

CREATE OR REPLACE FUNCTION public.sync_rider_availability(p_rider_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_rider_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.riders AS rider
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.orders AS assigned_order
      WHERE assigned_order.rider_id = p_rider_id
        AND assigned_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
    ) THEN 'On Delivery'
    WHEN rider.status = 'On Delivery' THEN 'Available'
    ELSE rider.status
  END
  WHERE rider.id = p_rider_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_rider_availability(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_rider_after_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.rider_id IS NOT NULL THEN
    PERFORM public.sync_rider_availability(OLD.rider_id);
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.rider_id IS NOT NULL THEN
    PERFORM public.sync_rider_availability(NEW.rider_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_rider_after_order_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_sync_rider_status_v1 ON public.orders;
CREATE TRIGGER orders_sync_rider_status_v1
  AFTER INSERT OR UPDATE OF rider_id, status OR DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_rider_after_order_change();

UPDATE public.riders AS rider
SET status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id = rider.id
      AND assigned_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
  ) THEN 'On Delivery'
  WHEN rider.status = 'On Delivery' THEN 'Available'
  ELSE rider.status
END
WHERE rider.status IS DISTINCT FROM CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id = rider.id
      AND assigned_order.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
  ) THEN 'On Delivery'
  WHEN rider.status = 'On Delivery' THEN 'Available'
  ELSE rider.status
END;

CREATE OR REPLACE FUNCTION public.prevent_rider_delete_with_active_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders AS assigned_order
    WHERE assigned_order.rider_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Unassign this rider from all orders before deleting the rider.'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_rider_delete_with_active_delivery() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS riders_prevent_active_delete_v1 ON public.riders;
CREATE TRIGGER riders_prevent_active_delete_v1
  BEFORE DELETE ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_rider_delete_with_active_delivery();

CREATE OR REPLACE FUNCTION public.assign_order_rider(
  p_order_id bigint,
  p_rider_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  order_type text;
  order_status text;
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only authorized administrators can assign delivery riders.'
      USING ERRCODE = '42501';
  END IF;

  SELECT delivery_order.order_type, delivery_order.status
  INTO order_type, order_status
  FROM public.orders AS delivery_order
  WHERE delivery_order.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % was not found.', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  IF order_type IS DISTINCT FROM 'delivery' THEN
    RAISE EXCEPTION 'Riders can only be assigned to delivery orders.'
      USING ERRCODE = '23514';
  END IF;

  IF p_rider_id IS NOT NULL
     AND (
       order_status IS NULL
       OR order_status NOT IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
     ) THEN
    RAISE EXCEPTION 'Riders can only be assigned to active delivery orders.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders
  SET rider_id = p_rider_id
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_order_rider(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_order_rider(bigint, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
