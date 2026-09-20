"""Create habits, user habit templates, and progress entries.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "habits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("category", sa.String(64), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_habits"),
        sa.CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100",
            name="ck_habits_name",
        ),
        sa.CheckConstraint(
            "description IS NULL OR "
            "(description = btrim(description) AND "
            "char_length(description) BETWEEN 1 AND 1000)",
            name="ck_habits_description",
        ),
        sa.CheckConstraint(
            "category IS NULL OR "
            "(category = btrim(category) AND category = lower(category) AND "
            "char_length(category) BETWEEN 1 AND 64)",
            name="ck_habits_category",
        ),
    )
    op.create_index(
        "uq_habits_name_lower", "habits", [sa.text("lower(name)")], unique=True
    )

    op.create_table(
        "user_habits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("habit_id", sa.Uuid(), nullable=False),
        sa.Column("target_value", sa.Numeric(12, 3), nullable=False),
        sa.Column("target_unit", sa.String(32), nullable=False),
        sa.Column("target_period", sa.String(8), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_user_habits"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_habits_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["habit_id"],
            ["habits.id"],
            name="fk_user_habits_habit_id_habits",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "target_value > 0", name="ck_user_habits_target_value"
        ),
        sa.CheckConstraint(
            "target_unit = btrim(target_unit) AND "
            "target_unit = lower(target_unit) AND "
            "char_length(target_unit) BETWEEN 1 AND 32",
            name="ck_user_habits_target_unit",
        ),
        sa.CheckConstraint(
            "target_period IN ('day', 'week', 'month')",
            name="ck_user_habits_target_period",
        ),
    )
    op.create_index(
        "uq_user_habits_active",
        "user_habits",
        ["user_id", "habit_id"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )

    op.create_table(
        "habit_progress_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_habit_id", sa.Uuid(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("target_value", sa.Numeric(12, 3), nullable=False),
        sa.Column("target_unit", sa.String(32), nullable=False),
        sa.Column("target_period", sa.String(8), nullable=False),
        sa.Column("result_value", sa.Numeric(12, 3), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_habit_progress_entries"),
        sa.ForeignKeyConstraint(
            ["user_habit_id"],
            ["user_habits.id"],
            name="fk_habit_progress_entries_user_habit_id_user_habits",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_habit_id",
            "period_start",
            name="uq_habit_progress_entries_period",
        ),
        sa.CheckConstraint(
            "target_value > 0", name="ck_habit_progress_entries_target_value"
        ),
        sa.CheckConstraint(
            "target_unit = btrim(target_unit) AND "
            "target_unit = lower(target_unit) AND "
            "char_length(target_unit) BETWEEN 1 AND 32",
            name="ck_habit_progress_entries_target_unit",
        ),
        sa.CheckConstraint(
            "target_period IN ('day', 'week', 'month')",
            name="ck_habit_progress_entries_target_period",
        ),
        sa.CheckConstraint(
            "result_value >= 0", name="ck_habit_progress_entries_result_value"
        ),
        sa.CheckConstraint(
            "(status = 'done' AND result_value >= target_value) OR "
            "(status = 'tried' AND result_value > 0 AND "
            "result_value < target_value) OR "
            "(status = 'skipped' AND result_value = 0)",
            name="ck_habit_progress_entries_status",
        ),
    )


def downgrade() -> None:
    op.drop_table("habit_progress_entries")
    op.drop_index("uq_user_habits_active", table_name="user_habits")
    op.drop_table("user_habits")
    op.drop_index("uq_habits_name_lower", table_name="habits")
    op.drop_table("habits")
