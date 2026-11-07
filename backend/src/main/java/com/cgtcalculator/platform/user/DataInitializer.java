package com.cgtcalculator.platform.user;

import java.util.LinkedHashSet;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.cgtcalculator.platform.config.AppProperties;

/**
 * Port of the Laravel seeders: creates the permissions, the "admin" (all permissions) and "investor"
 * (view-investing-tools) roles, and a bootstrap admin user taken from ADMIN_EMAIL / ADMIN_PASSWORD.
 */
@Component
public class DataInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final PermissionRepository permissionRepository;
    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AppProperties properties;

    public DataInitializer(PermissionRepository permissionRepository, RoleRepository roleRepository,
                           UserRepository userRepository, PasswordEncoder passwordEncoder, AppProperties properties) {
        this.permissionRepository = permissionRepository;
        this.roleRepository = roleRepository;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        Set<Permission> all = new LinkedHashSet<>();
        for (String name : Permissions.ALL) {
            all.add(permissionRepository.findByName(name).orElseGet(() -> permissionRepository.save(new Permission(name))));
        }

        Role admin = roleRepository.findByName(Role.ADMIN).orElseGet(() -> {
            Role role = new Role(Role.ADMIN);
            role.setPermissions(new LinkedHashSet<>(all));
            return roleRepository.save(role);
        });

        if (!roleRepository.existsByName(Role.INVESTOR)) {
            Role investor = new Role(Role.INVESTOR);
            permissionRepository.findByName(Permissions.VIEW_INVESTING_TOOLS).ifPresent(investor.getPermissions()::add);
            roleRepository.save(investor);
        }

        if (userRepository.count() == 0) {
            AppProperties.Admin adminProps = properties.admin();
            if (isBlank(adminProps.email()) || isBlank(adminProps.password())) {
                log.warn("No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the initial admin account.");
                return;
            }
            User user = new User(isBlank(adminProps.name()) ? "Admin" : adminProps.name(), adminProps.email().trim(),
                    passwordEncoder.encode(adminProps.password()));
            user.getRoles().add(admin);
            userRepository.save(user);
            log.info("Created initial admin user {}", user.getEmail());
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
