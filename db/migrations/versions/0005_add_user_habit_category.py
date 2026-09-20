"""Add a personal category to user habit templates.

Revision ID: 0005
Revises: 0004
"""

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_habits", sa.Column("category", sa.String(64), nullable=True))
    op.execute(
        "UPDATE user_habits SET category = habits.category "
        "FROM habits WHERE user_habits.habit_id = habits.id"
    )
    op.create_check_constraint(
        "ck_user_habits_category",
        "user_habits",
        "category IS NULL OR "
        "(category = btrim(category) AND category = lower(category) AND "
        "char_length(category) BETWEEN 1 AND 64)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_habits_category", "user_habits", type_="check")
    op.drop_column("user_habits", "category")
