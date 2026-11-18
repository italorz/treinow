CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL, email varchar(254) NOT NULL UNIQUE,
 password_hash varchar(256) NOT NULL, role varchar(16) NOT NULL, tenant_id uuid,
 email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY, name varchar(120) NOT NULL, owner_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_tenant_id_fkey') THEN
  ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES tenants(id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS profiles (
 id uuid PRIMARY KEY, student_id uuid NOT NULL UNIQUE REFERENCES users(id), goal varchar(32) NOT NULL,
 level varchar(16) NOT NULL, training_days integer[] NOT NULL, duration_minutes integer NOT NULL,
 location varchar(16) NOT NULL, equipment varchar[] NOT NULL, weight_kg float8 NOT NULL, height_cm integer NOT NULL,
 age integer NOT NULL, sex varchar(16) NOT NULL, priority_muscles varchar[] NOT NULL DEFAULT '{}', intensity varchar(16) NOT NULL,
 injuries jsonb NOT NULL DEFAULT '[]', bmi float8 NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exercises (
 id uuid PRIMARY KEY, slug varchar(160) NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT false,
 locale varchar(8) NOT NULL, name varchar(160) NOT NULL, name_raw varchar(160) NOT NULL, muscle_primary varchar(32) NOT NULL,
 secondary_muscles varchar[] NOT NULL DEFAULT '{}', equipment varchar(32) NOT NULL, complexity varchar(16) NOT NULL,
 movement_pattern varchar(32) NOT NULL, target_key varchar(64) NOT NULL, is_unilateral boolean NOT NULL DEFAULT false,
 is_stretch boolean NOT NULL DEFAULT false, is_warmup boolean NOT NULL DEFAULT false, joints varchar[] NOT NULL DEFAULT '{}',
 contraindications varchar[] NOT NULL DEFAULT '{}', requires_high_mind_muscle_awareness boolean NOT NULL DEFAULT false,
 search_tokens varchar[] NOT NULL DEFAULT '{}', classification jsonb, needs_review boolean NOT NULL DEFAULT false,
 guidance jsonb, video jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workout_plans (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users(id), version integer NOT NULL, active boolean NOT NULL DEFAULT true,
 source varchar(32) NOT NULL, days jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(student_id,version)
);
CREATE TABLE IF NOT EXISTS workout_sessions (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users(id), workout_date date NOT NULL, selections jsonb NOT NULL DEFAULT '{}',
 status varchar(16) NOT NULL DEFAULT 'active', comment varchar(1000), missing_exercise_ids varchar[] NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(student_id,workout_date)
);
CREATE TABLE IF NOT EXISTS workout_logs (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users(id), exercise_id uuid NOT NULL REFERENCES exercises(id),
 session_id uuid REFERENCES workout_sessions(id), sets integer NOT NULL, reps integer NOT NULL, load_kg float8 NOT NULL,
 completed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS measurements (
 id uuid PRIMARY KEY, student_id uuid NOT NULL REFERENCES users(id), measured_at timestamptz NOT NULL,
 weight_kg float8 NOT NULL, height_cm integer NOT NULL, bmi float8 NOT NULL, waist_cm float8
);
CREATE TABLE IF NOT EXISTS memberships (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), student_id uuid NOT NULL REFERENCES users(id),
 status varchar(16) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,student_id)
);
CREATE TABLE IF NOT EXISTS consents (
 id uuid PRIMARY KEY, membership_id uuid NOT NULL REFERENCES memberships(id), version varchar(16) NOT NULL,
 scopes varchar[] NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, document_hash varchar(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), email varchar(254) NOT NULL, token_hash varchar(64) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'pending', expires_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analytics_snapshots (
 id uuid PRIMARY KEY, student_id uuid NOT NULL UNIQUE REFERENCES users(id), adherence_percent integer NOT NULL,
 total_volume_kg float8 NOT NULL, personal_records integer NOT NULL, weekly_volume jsonb NOT NULL DEFAULT '[]',
 weight_trend jsonb NOT NULL DEFAULT '[]', bmi_trend jsonb NOT NULL DEFAULT '[]', generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_plans_student_active ON workout_plans(student_id,active,version DESC);
CREATE INDEX IF NOT EXISTS go_logs_student_completed ON workout_logs(student_id,completed_at);
CREATE INDEX IF NOT EXISTS go_membership_tenant_status ON memberships(tenant_id,status);
CREATE INDEX IF NOT EXISTS go_consent_active ON consents(membership_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS go_invitation_token ON invitations(token_hash);
CREATE INDEX IF NOT EXISTS go_active_catalog_id ON exercises(id)
 WHERE is_active AND classification->>'source'='appdb-catalog-v2';
