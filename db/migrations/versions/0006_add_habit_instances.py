"""Add timed habit instances and immutable snapshots.

Revision ID: 0006
Revises: 0005
"""

import calendar
from datetime import timedelta
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

FINAL_STATUS = (
    "(status = 'done' AND result_value >= target_value) OR "
    "(status = 'tried' AND result_value > 0 AND result_value < target_value) OR "
    "(status = 'skipped' AND result_value = 0)"
)


def upgrade() -> None:
    op.add_column("user_habits", sa.Column("schedule_anchor", sa.DateTime(timezone=True)))
    op.add_column("user_habits", sa.Column("next_instance_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE user_habits SET schedule_anchor = created_at, next_instance_at = created_at")
    op.add_column("habit_progress_entries", sa.Column("period_end", sa.DateTime(timezone=True)))
    op.add_column("habit_progress_entries", sa.Column("habit_name", sa.String(100)))
    op.add_column("habit_progress_entries", sa.Column("category", sa.String(64)))
    op.alter_column(
        "habit_progress_entries", "period_start", existing_type=sa.Date(),
        type_=sa.DateTime(timezone=True), existing_nullable=False,
        postgresql_using="period_start::timestamp AT TIME ZONE 'Europe/Moscow'",
    )
    # Preserve existing results and their calendar periods; historical categories
    # were not stored, so use the last known template category for these rows only.
    op.execute("""
        UPDATE habit_progress_entries AS entry
        SET habit_name = habit.name, category = template.category,
            period_end = ((entry.period_start AT TIME ZONE 'Europe/Moscow') +
                CASE entry.target_period
                    WHEN 'day' THEN interval '1 day'
                    WHEN 'week' THEN interval '7 days'
                    ELSE interval '1 month'
                END) AT TIME ZONE 'Europe/Moscow'
        FROM user_habits AS template JOIN habits AS habit ON habit.id = template.habit_id
        WHERE template.id = entry.user_habit_id
    """)
    # Existing final records must not be recreated or overlapped. Resume at the
    # first boundary of the original addition schedule after those legacy records.
    connection = op.get_bind()
    rows = connection.execute(sa.text("""
        SELECT template.id, template.created_at, template.target_period, max(entry.period_end) AS last_end
        FROM user_habits AS template JOIN habit_progress_entries AS entry ON entry.user_habit_id = template.id
        GROUP BY template.id
    """)).mappings().all()
    for row in rows:
        anchor = row["created_at"].astimezone(ZoneInfo("Europe/Moscow"))
        cursor = anchor
        index = 0
        while cursor < row["last_end"]:
            index += 1
            if row["target_period"] == "month":
                year, month = divmod(anchor.year * 12 + anchor.month - 1 + index, 12)
                month += 1
                cursor = anchor.replace(year=year, month=month,
                                        day=min(anchor.day, calendar.monthrange(year, month)[1]))
            else:
                cursor = anchor + timedelta(days=index * (1 if row["target_period"] == "day" else 7))
        connection.execute(sa.text("UPDATE user_habits SET next_instance_at = :cursor WHERE id = :id"),
                           {"cursor": cursor, "id": row["id"]})
    for column in ("schedule_anchor", "next_instance_at"):
        op.alter_column("user_habits", column, nullable=False)
    for column in ("period_end", "habit_name"):
        op.alter_column("habit_progress_entries", column, nullable=False)
    op.drop_constraint("ck_habit_progress_entries_status", "habit_progress_entries", type_="check")
    op.create_check_constraint("ck_habit_progress_entries_status", "habit_progress_entries",
                               "status = 'active' OR " + FINAL_STATUS)
    op.create_check_constraint("ck_habit_progress_entries_period_bounds", "habit_progress_entries",
                               "period_end > period_start")
    op.create_check_constraint("ck_habit_progress_entries_category", "habit_progress_entries",
                               "category IS NULL OR (category = btrim(category) AND category = lower(category) "
                               "AND char_length(category) BETWEEN 1 AND 64)")
    op.create_index("uq_habit_progress_entries_active", "habit_progress_entries", ["user_habit_id"],
                    unique=True, postgresql_where=sa.text("status = 'active'"))


def downgrade() -> None:
    op.drop_index("uq_habit_progress_entries_active", table_name="habit_progress_entries")
    op.drop_constraint("ck_habit_progress_entries_category", "habit_progress_entries", type_="check")
    op.drop_constraint("ck_habit_progress_entries_period_bounds", "habit_progress_entries", type_="check")
    op.drop_constraint("ck_habit_progress_entries_status", "habit_progress_entries", type_="check")
    op.execute("""
        UPDATE habit_progress_entries SET status = CASE
            WHEN result_value >= target_value THEN 'done'
            WHEN result_value > 0 THEN 'tried' ELSE 'skipped' END
        WHERE status = 'active'
    """)
    op.create_check_constraint("ck_habit_progress_entries_status", "habit_progress_entries", FINAL_STATUS)
    op.alter_column("habit_progress_entries", "period_start", existing_type=sa.DateTime(timezone=True),
                    type_=sa.Date(), existing_nullable=False,
                    postgresql_using="(period_start AT TIME ZONE 'Europe/Moscow')::date")
    for column in ("category", "habit_name", "period_end"):
        op.drop_column("habit_progress_entries", column)
    for column in ("next_instance_at", "schedule_anchor"):
        op.drop_column("user_habits", column)
