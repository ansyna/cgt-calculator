package com.cgtcalculator.platform.backup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.StringWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

import com.cgtcalculator.CgtCalculatorApplication;

/**
 * A backup restores on a real Postgres (TEST_POSTGRES_URL / _USER / _PASSWORD, set in CI), the way the README says:
 * into a database the app has started on.
 */
class BackupRoundTripTest {

    @Test
    void restoresWhatWasBackedUp() throws SQLException {
        String server = System.getenv("TEST_POSTGRES_URL");
        assumeTrue(server != null && !server.isBlank(), "TEST_POSTGRES_URL is not set");
        String user = System.getenv("TEST_POSTGRES_USER");
        String password = System.getenv("TEST_POSTGRES_PASSWORD") == null ? "" : System.getenv("TEST_POSTGRES_PASSWORD");
        String name = "backup_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        try (Connection connection = DriverManager.getConnection(server, user, password);
             Statement statement = connection.createStatement()) {
            statement.execute("create database " + name);
        }
        String url = server.replaceFirst("^(jdbc:\\w+://[^/]+/)[^?]*", "$1" + name);

        try (ConfigurableApplicationContext app = new SpringApplicationBuilder(CgtCalculatorApplication.class).run(
                "--spring.datasource.url=" + url, "--spring.datasource.username=" + user,
                "--spring.datasource.password=" + password, "--server.port=0",
                "--app.jwt.secret=backup-test-secret-backup-test-secret-0123",
                "--app.admin.email=admin@example.com", "--app.admin.password=backup-test-password")) {
            JdbcTemplate jdbc = app.getBean(JdbcTemplate.class);
            jdbc.update("insert into users (name, email, password, created_at) values ('Ann O''Brien', 'ann@example.com', 'x', now())");
            jdbc.update("insert into activity_log (at, actor, action, target, details, ip) values (now(), '', 'login', 'ann@example.com', '', '1.2.3.4')");
            StringWriter backup = new StringWriter();
            app.getBean(BackupService.class).write(backup);

            // things change after the backup
            jdbc.update("delete from users where email = 'ann@example.com'");
            jdbc.update("insert into users (name, email, password, created_at) values ('Later', 'later@example.com', 'x', now())");

            try (Connection connection = DriverManager.getConnection(url, user, password);
                 Statement statement = connection.createStatement()) {
                statement.execute(backup.toString());
            }
            assertThat(jdbc.queryForList("select email from users order by id", String.class))
                    .containsExactly("admin@example.com", "ann@example.com");
            assertThat(jdbc.queryForObject("select name from users where email = 'ann@example.com'", String.class)).isEqualTo("Ann O'Brien");
            assertThat(jdbc.queryForObject("select count(*) from model_has_roles", Integer.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from activity_log where action = 'login'", Integer.class)).isEqualTo(1);
            // new rows continue after the restored ones
            jdbc.update("insert into users (name, email, password, created_at) values ('New', 'new@example.com', 'x', now())");
            assertThat(jdbc.queryForObject("select id from users where email = 'new@example.com'", Long.class)).isEqualTo(3L);
        }
    }
}
