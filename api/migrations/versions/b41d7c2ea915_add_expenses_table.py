"""add_expenses_table

Revision ID: b41d7c2ea915
Revises: 066944e7ca6c
Create Date: 2026-07-28 11:20:14.882431

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b41d7c2ea915'
down_revision: Union[str, None] = '066944e7ca6c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('expenses',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('business_id', sa.UUID(), nullable=False),
    sa.Column('category', sa.String(length=50), nullable=False),
    sa.Column('amount', sa.Numeric(precision=15, scale=2), nullable=False),
    sa.Column('vat_amount', sa.Numeric(precision=15, scale=2), nullable=True),
    sa.Column('expense_date', sa.Date(), nullable=False),
    sa.Column('payment_method', sa.String(length=20), nullable=False),
    sa.Column('vendor_name', sa.String(length=255), nullable=True),
    sa.Column('reference', sa.String(length=100), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('source_id', sa.UUID(), nullable=True),
    sa.Column('recorded_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], ),
    sa.ForeignKeyConstraint(['recorded_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_expenses_business_id'), 'expenses', ['business_id'], unique=False)
    op.create_index('ix_expenses_business_date', 'expenses', ['business_id', 'expense_date'], unique=False, postgresql_where=sa.text('deleted_at IS NULL'))
    # Makes system-generated postings (e.g. a disbursed payroll run) idempotent.
    op.create_index('uq_expenses_source', 'expenses', ['business_id', 'source', 'source_id'], unique=True, postgresql_where=sa.text('source_id IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('uq_expenses_source', table_name='expenses', postgresql_where=sa.text('source_id IS NOT NULL'))
    op.drop_index('ix_expenses_business_date', table_name='expenses', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index(op.f('ix_expenses_business_id'), table_name='expenses')
    op.drop_table('expenses')
