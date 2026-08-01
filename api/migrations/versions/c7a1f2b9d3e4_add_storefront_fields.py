"""add storefront fields to businesses and items

Revision ID: c7a1f2b9d3e4
Revises: b41d7c2ea915
Create Date: 2026-07-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7a1f2b9d3e4'
down_revision: Union[str, None] = 'b41d7c2ea915'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # businesses — public storefront
    op.add_column('businesses', sa.Column('storefront_slug', sa.String(length=60), nullable=True))
    op.add_column('businesses', sa.Column('storefront_enabled', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('businesses', sa.Column('storefront_tagline', sa.String(length=160), nullable=True))
    op.add_column('businesses', sa.Column('storefront_whatsapp', sa.String(length=20), nullable=True))
    op.create_index(
        'uq_business_storefront_slug',
        'businesses',
        ['storefront_slug'],
        unique=True,
        postgresql_where=sa.text('storefront_slug IS NOT NULL'),
    )

    # items — public catalog fields
    op.add_column('items', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('items', sa.Column('image_url', sa.Text(), nullable=True))
    op.add_column('items', sa.Column('image_key', sa.String(length=255), nullable=True))
    op.add_column('items', sa.Column('storefront_visible', sa.Boolean(), server_default=sa.text('true'), nullable=False))


def downgrade() -> None:
    op.drop_column('items', 'storefront_visible')
    op.drop_column('items', 'image_key')
    op.drop_column('items', 'image_url')
    op.drop_column('items', 'description')
    op.drop_index('uq_business_storefront_slug', table_name='businesses')
    op.drop_column('businesses', 'storefront_whatsapp')
    op.drop_column('businesses', 'storefront_tagline')
    op.drop_column('businesses', 'storefront_enabled')
    op.drop_column('businesses', 'storefront_slug')
