package com.cgtcalculator.platform.backup;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.sql.ResultSetMetaData;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.cgtcalculator.platform.backup.BackupTables.Table;

/**
 * The app's own data as a SQL script for Postgres: users, roles, permissions, pending one-time links, the activity
 * log and the API usage counts. Not the cached API responses (fetched again as needed) or the logins (everyone
 * logs in again). Restoring it into a database the app has started on (so the tables exist) replaces those rows:
 * see the README, "Backups".
 */
@Service
public class BackupService {

    /** The shared tables; parents before the rows that refer to them. The apps' own come after (BackupTables). */
    private static final List<Table> SHARED = List.of(
            new Table("permissions", "id", true),
            new Table("roles", "id", true),
            new Table("role_has_permissions", "role_id, permission_id", false),
            new Table("users", "id", true),
            new Table("model_has_roles", "user_id, role_id", false),
            new Table("one_time_tokens", "id", true),
            new Table("activity_log", "id", true),
            // the share trades (platform.ledger) and settings
            new Table("share_trades", "id", true),
            new Table("user_settings", "id", true));

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final List<Table> tables;

    public BackupService(JdbcTemplate jdbc, Clock clock, ObjectProvider<BackupTables> apps) {
        this.jdbc = jdbc;
        this.clock = clock;
        List<Table> all = new ArrayList<>(SHARED);
        apps.orderedStream().forEach(app -> all.addAll(app.tables()));
        this.tables = List.copyOf(all);
    }

    /** The tables backed up, in the order they're restored. */
    List<String> tableNames() {
        return tables.stream().map(Table::name).toList();
    }

    /**
     * Writes the script; returns the number of rows in it. The tables as they were at one moment: a trade added while
     * the backup is written is in it with all it refers to, or not at all.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public int write(Writer out) {
        try {
            out.write("-- CGT Calculator backup of " + clock.instant() + ": restore with\n");
            out.write("--   psql \"$DATABASE_URL\" --set ON_ERROR_STOP=1 -f backup.sql\n");
            out.write("-- into a database the app has started on. It replaces the users, roles, links, activity and usage.\n");
            out.write("begin;\n");
            List<String> names = new ArrayList<>(tables.stream().map(Table::name).toList());
            // the logins point at the users being replaced; everyone logs in again
            names.add("refresh_tokens");
            out.write("truncate table " + String.join(", ", names) + " restart identity cascade;\n");
            int rows = 0;
            for (Table table : tables) {
                rows += writeRows(table, out);
            }
            for (Table table : tables) {
                if (table.identity()) {
                    // the next new row continues after the restored ones
                    out.write("select setval(pg_get_serial_sequence('" + table.name() + "', 'id'), "
                            + "coalesce((select max(id) from " + table.name() + "), 0) + 1, false);\n");
                }
            }
            out.write("commit;\n");
            out.flush();
            return rows;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private int writeRows(Table table, Writer out) {
        int[] rows = {0};
        // the table names are constants of the app (SHARED, BackupTables), never input
        jdbc.query("select * from " + table.name() + " order by " + table.orderBy(), result -> {
            ResultSetMetaData meta = result.getMetaData();
            StringBuilder insert = new StringBuilder("insert into ").append(table.name()).append(" (");
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                if (i > 1) insert.append(", ");
                insert.append(meta.getColumnName(i).toLowerCase(java.util.Locale.ROOT));
            }
            insert.append(") values (");
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                if (i > 1) insert.append(", ");
                insert.append(literal(result.getObject(i)));
            }
            insert.append(");\n");
            try {
                out.write(insert.toString());
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            rows[0]++;
        });
        return rows[0];
    }

    /** A value as a Postgres literal. */
    static String literal(Object value) {
        return switch (value) {
            case null -> "null";
            case Boolean b -> b.toString();
            case Number n -> n.toString();
            case java.sql.Timestamp t -> quote(t.toInstant().toString());
            case OffsetDateTime t -> quote(t.toInstant().toString());
            case Instant t -> quote(t.toString());
            case java.sql.Date d -> quote(d.toLocalDate().toString());
            case LocalDate d -> quote(d.toString());
            case byte[] bytes -> quote("\\x" + HexFormat.of().formatHex(bytes));
            default -> quote(value.toString());
        };
    }

    private static String quote(String text) {
        return "'" + text.replace("'", "''") + "'";
    }
}
