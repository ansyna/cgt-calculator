package com.cgtcalculator.platform.user;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

import jakarta.persistence.EntityManagerFactory;

/** The users list doesn't make a query per user for their roles and permissions. */
@SpringBootTest(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@ActiveProfiles("test")
class UserQueriesTest {

    @Autowired
    private UserRepository users;
    @Autowired
    private RoleRepository roles;
    @Autowired
    private EntityManagerFactory entityManagerFactory;
    @Autowired
    private TransactionTemplate transaction;

    @Test
    void aPageOfUsersLoadsTheirRolesTogether() {
        Role investor = roles.findByName(Role.INVESTOR).orElseThrow();
        transaction.executeWithoutResult(status -> {
            for (int i = 0; i < 20; i++) {
                User user = new User("Batch " + i, "batch" + i + "@example.com", "x");
                user.setRoles(Set.of(investor));
                users.save(user);
            }
        });
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        List<String> described = transaction.execute(status -> users.findAll(PageRequest.of(0, 20, Sort.by("id").descending()))
                .map(user -> user.getRoles().stream().map(Role::getName).toList() + " " + user.authorityNames().toList())
                .getContent());
        assertThat(described).hasSize(20);
        // the page, the users' roles and the roles' permissions (and perhaps the count)
        assertThat(statistics.getPrepareStatementCount()).isLessThanOrEqualTo(4);
    }
}
