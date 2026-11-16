"""Store externally generated exercise execution guidance."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("exercises", sa.Column("guidance", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("exercises", "guidance")
