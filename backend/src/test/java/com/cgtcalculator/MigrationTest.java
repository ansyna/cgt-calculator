package com.cgtcalculator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

/**
 * The migrations on a real Postgres server (H2 in PostgreSQL mode is covered by every other test). Runs when CI
 * provides the server: TEST_POSTGRES_URL / _USER / _PASSWORD, e.g. jdbc:postgresql://localhost:5432/postgres. Each
 * test creates its own database there.
 */
class MigrationTest {

    private record Server(String url, String user, String password) {
        static Server from(String prefix) {
            String url = System.getenv(prefix + "_URL");
            assumeTrue(url != null && !url.isBlank(), prefix + "_URL is not set");
            return new Server(url, System.getenv(prefix + "_USER"), System.getenv(prefix + "_PASSWORD"));
        }

        /** A new, empty database on the server; returns its JDBC URL. */
        String createDatabase() throws SQLException {
            String name = "migration_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            try (Connection connection = DriverManager.getConnection(url, user, password);
                 Statement statement = connection.createStatement()) {
                statement.execute("create database " + name);
            }
            return url.replaceFirst("^(jdbc:\\w+://[^/]+/)[^?]*", "$1" + name);
        }
    }

    private static ConfigurableApplicationContext start(String url, Server server) {
        return new SpringApplicationBuilder(CgtCalculatorApplication.class).run(
                "--spring.datasource.url=" + url,
                "--spring.datasource.username=" + server.user(),
                "--spring.datasource.password=" + (server.password() == null ? "" : server.password()),
                "--server.port=0",
                "--app.jwt.secret=migration-test-secret-migration-test-secret",
                "--app.admin.email=admin@example.com",
                "--app.admin.password=migration-test-password");
    }

    private static List<Map<String, Object>> history(ConfigurableApplicationContext app) {
        return app.getBean(JdbcTemplate.class)
                .queryForList("select version, type, success from flyway_schema_history order by installed_rank");
    }

    /** Flyway creates the schema, Hibernate validates it and the app seeds its roles and admin. */
    private static void migratesAnEmptyDatabase(Server server) throws SQLException {
        try (ConfigurableApplicationContext app = start(server.createDatabase(), server)) {
            List<Map<String, Object>> history = history(app);
            assertThat(history).extracting(row -> row.get("version")).containsExactly("1");
            assertThat(history).extracting(row -> row.get("type")).containsExactly("SQL");
            JdbcTemplate jdbc = app.getBean(JdbcTemplate.class);
            assertThat(jdbc.queryForObject("select count(*) from users", Integer.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from roles", Integer.class)).isEqualTo(2);
        }
    }

    @Test
    void postgresMigratesAnEmptyDatabase() throws SQLException {
        migratesAnEmptyDatabase(Server.from("TEST_POSTGRES"));
    }
}
