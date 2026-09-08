"""Separate the current library from retained historical exercise records."""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('exercises', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index('ix_exercises_is_active', 'exercises', ['is_active'])

def downgrade():
    op.drop_index('ix_exercises_is_active', table_name='exercises')
    op.drop_column('exercises', 'is_active')
