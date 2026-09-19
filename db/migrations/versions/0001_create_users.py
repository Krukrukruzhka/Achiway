"""Create user profiles.

Revision ID: 0001
Revises:
"""

from alembic import op
import sqlalchemy as sa


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("login", sa.String(64), nullable=False),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("gender", sa.String(16), nullable=True),
        sa.Column("age", sa.SmallInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("login", name="uq_users_login"),
        sa.CheckConstraint(
            "login ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'", name="ck_users_login"
        ),
        sa.CheckConstraint(
            "name IS NULL OR (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100)",
            name="ck_users_name",
        ),
        sa.CheckConstraint(
            "gender IS NULL OR gender IN ('male', 'female', 'other')",
            name="ck_users_gender",
        ),
        sa.CheckConstraint("age IS NULL OR age BETWEEN 0 AND 150", name="ck_users_age"),
    )


def downgrade() -> None:
    op.drop_table("users")
