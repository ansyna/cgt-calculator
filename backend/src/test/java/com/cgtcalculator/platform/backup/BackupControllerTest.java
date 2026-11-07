package com.cgtcalculator.platform.backup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** The monthly backup's download: only with the secret token. */
@SpringBootTest(properties = "app.backup.token=" + BackupControllerTest.TOKEN)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BackupControllerTest {

    static final String TOKEN = "backup-token-backup-token-backup-token-0123";

    @Autowired
    private MockMvc mvc;
    @Autowired
    private BackupService backups;
    @Autowired
    private JdbcTemplate jdbc;

    /** Tables not backed up: the migrations' history, the logins, and what's fetched again (ECB rates). */
    private static final Set<String> NOT_BACKED_UP = Set.of("flyway_schema_history", "refresh_tokens", "fx_rates");

    @Test
    void everyTableIsBackedUpOrLeftOutOnPurpose() {
        List<String> all = jdbc.queryForList("select table_name from information_schema.tables where table_schema = 'public'", String.class)
                .stream().map(t -> t.toLowerCase(Locale.ROOT)).toList();
        // a new app's table needs a BackupTables, or a reason here
        assertThat(all.stream().filter(t -> !NOT_BACKED_UP.contains(t))).containsExactlyInAnyOrderElementsOf(backups.tableNames());
    }

    @Test
    void onlyWithTheToken() throws Exception {
        mvc.perform(get("/api/backup")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/backup").header(BackupController.TOKEN_HEADER, TOKEN + "x")).andExpect(status().isUnauthorized());
        // a login doesn't open it either: it isn't for people
        mvc.perform(get("/api/backup").header("Authorization", "Bearer " + TOKEN)).andExpect(status().isUnauthorized());
    }

    @Test
    void theAppsOwnDataAsSql() throws Exception {
        String sql = mvc.perform(get("/api/backup").header(BackupController.TOKEN_HEADER, TOKEN))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(sql).startsWith("-- CGT Calculator backup").contains("begin;\ntruncate table permissions, roles")
                .contains("insert into users (").contains("'admin@example.com'").contains("insert into roles (")
                .contains("select setval(pg_get_serial_sequence('users', 'id')").endsWith("commit;\n");
        // the shared tables, then the CGT calculator's own (BackupTables)
        assertThat(sql).contains("truncate table permissions, roles, role_has_permissions, users, model_has_roles, "
                + "one_time_tokens, activity_log, share_trades, user_settings, cgt_settings, refresh_tokens restart identity cascade;\n");
        // not the logins
        assertThat(sql).doesNotContain("insert into refresh_tokens");
    }

    @Test
    void valuesAreSqlLiterals() {
        assertThat(BackupService.literal(null)).isEqualTo("null");
        assertThat(BackupService.literal("O'Brien")).isEqualTo("'O''Brien'");
        assertThat(BackupService.literal(true)).isEqualTo("true");
        assertThat(BackupService.literal(42L)).isEqualTo("42");
        assertThat(BackupService.literal(java.sql.Timestamp.from(java.time.Instant.parse("2026-10-20T03:17:00Z"))))
                .isEqualTo("'2026-10-20T03:17:00Z'");
        assertThat(BackupService.literal(java.sql.Date.valueOf("2026-10-20"))).isEqualTo("'2026-10-20'");
    }
}
