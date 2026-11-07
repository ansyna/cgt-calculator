package com.cgtcalculator.platform.user;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.cgtcalculator.platform.account.AccountEmails;
import com.cgtcalculator.platform.account.ActivityService;
import com.cgtcalculator.platform.account.OneTimeTokenRepository;
import com.cgtcalculator.platform.account.Passwords;
import com.cgtcalculator.platform.account.RefreshTokenRepository;
import com.cgtcalculator.platform.account.SessionService;
import com.cgtcalculator.platform.web.ApiExceptionHandler.BadRequestException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.NotFoundException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

/**
 * Managing users (the admin's Users pages): each change is one transaction, recorded in the activity log. Emails
 * someone waits for (invitations, reset links) are sent by the caller once the change is saved; others go out
 * after the transaction.
 */
@Service
@Transactional
public class UserService {

    /** What an admin fills in on the user form; the password only when setting one. */
    public record UserFields(String name, String email, @Nullable String password, @Nullable String confirmPassword,
                             List<String> roles) {
    }

    private final UserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder passwordEncoder;
    private final AccountEmails emails;
    private final ActivityService activity;
    private final SessionService sessions;
    private final RefreshTokenRepository refreshTokens;
    private final OneTimeTokenRepository oneTimeTokens;

    public UserService(UserRepository users, RoleRepository roles, PasswordEncoder passwordEncoder, AccountEmails emails,
                       ActivityService activity, SessionService sessions, RefreshTokenRepository refreshTokens,
                       OneTimeTokenRepository oneTimeTokens) {
        this.users = users;
        this.roles = roles;
        this.passwordEncoder = passwordEncoder;
        this.emails = emails;
        this.activity = activity;
        this.sessions = sessions;
        this.refreshTokens = refreshTokens;
        this.oneTimeTokens = oneTimeTokens;
    }

    @Transactional(readOnly = true)
    public Page<User> page(int page, int size) {
        return users.findAll(PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100), Sort.by("id").descending()));
    }

    /** Sign-ups waiting for a role. */
    @Transactional(readOnly = true)
    public List<User> pendingApproval() {
        return users.findPendingApproval();
    }

    @Transactional(readOnly = true)
    public User find(Long id) {
        return users.findById(id).orElseThrow(() -> new NotFoundException("User not found"));
    }

    /** Gives a sign-up access (the investor role unless other roles are given); they are emailed after it is saved. */
    public User approve(Long id, @Nullable List<String> roleNames, String actor) {
        User user = find(id);
        List<String> names = roleNames == null || roleNames.isEmpty() ? List.of(Role.INVESTOR) : roleNames;
        user.setRoles(resolveRoles(names));
        emails.approved(user);
        activity.record("user.approved", actor, user.getEmail(), "Roles: " + String.join(", ", names));
        return user;
    }

    /**
     * Creates the invited person's account (no usable password until they accept), or updates a pending one to be
     * invited again. The caller sends the link once this is saved.
     */
    public User invite(String email, @Nullable String name, List<String> roleNames) {
        String address = email.trim();
        User user = users.findByEmailIgnoreCase(address).orElse(null);
        if (user != null && !user.isInvitationPending()) {
            throw new ValidationException("email", "This person already has an account.");
        }
        if (user == null) {
            String shownName = name == null || name.isBlank() ? address.substring(0, address.indexOf('@')) : name.trim();
            user = new User(shownName, address, passwordEncoder.encode(UUID.randomUUID().toString()));
            user.setInvitationPending(true);
        } else if (name != null && !name.isBlank()) {
            user.setName(name.trim());
        }
        user.setRoles(resolveRoles(roleNames));
        return users.save(user);
    }

    /** Whom a password reset link can be made for: not someone who hasn't accepted their invitation. */
    @Transactional(readOnly = true)
    public User resettable(Long id) {
        User user = find(id);
        if (user.isInvitationPending()) {
            throw new BadRequestException("This person hasn't accepted the invitation yet: invite them again instead.");
        }
        return user;
    }

    public User create(UserFields fields, String actor) {
        if (fields.password() == null || fields.password().isBlank()) {
            throw new ValidationException("password", "The password field is required.");
        }
        Passwords.validate(fields.password(), fields.confirmPassword(), PASSWORD_MISMATCH);
        String email = fields.email().trim();
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ValidationException("email", "The email has already been taken.");
        }
        User user = new User(fields.name().trim(), email, passwordEncoder.encode(fields.password()));
        user.setRoles(resolveRoles(fields.roles()));
        user = users.save(user);
        activity.record("user.created", actor, user.getEmail(), "Roles: " + String.join(", ", fields.roles()));
        return user;
    }

    /** @param self whether admins edit their own account (they can't remove their own admin role) */
    public User update(Long id, UserFields fields, boolean self, String actor) {
        User user = find(id);
        if (self && user.hasRole(Role.ADMIN) && !fields.roles().contains(Role.ADMIN)) {
            // otherwise the only admin could lock everyone out of user management
            throw new ValidationException("roles", "You cannot remove the admin role from your own account.");
        }
        String email = fields.email().trim();
        users.findByEmailIgnoreCase(email).filter(other -> !other.getId().equals(id)).ifPresent(other -> {
            throw new ValidationException("email", "The email has already been taken.");
        });
        List<String> changes = new ArrayList<>();
        if (fields.password() != null && !fields.password().isBlank()) {
            Passwords.validate(fields.password(), fields.confirmPassword(), PASSWORD_MISMATCH);
            user.setPassword(passwordEncoder.encode(fields.password()));
            // a new password ends the user's other logins
            sessions.endAll(user);
            changes.add("password changed");
        }
        if (!user.getName().equals(fields.name().trim())) changes.add("name");
        if (!user.getEmail().equalsIgnoreCase(email)) changes.add("email (was " + user.getEmail() + ")");
        List<String> oldRoles = user.getRoles().stream().map(Role::getName).toList();
        user.setName(fields.name().trim());
        user.setEmail(email);
        user.setRoles(resolveRoles(fields.roles()));
        List<String> newRoles = user.getRoles().stream().map(Role::getName).toList();
        if (!oldRoles.equals(newRoles)) changes.add("roles: " + String.join(", ", newRoles));
        activity.record("user.updated", actor, user.getEmail(), changes.isEmpty() ? "No changes" : String.join("; ", changes));
        return user;
    }

    /** @param self whether admins delete their own account, which they can't */
    public void delete(Long id, boolean self, String actor) {
        if (self) {
            throw new BadRequestException("You cannot delete your own account.");
        }
        User user = find(id);
        refreshTokens.deleteByUser(user);
        oneTimeTokens.deleteByUser(user);
        users.delete(user);
        activity.record("user.deleted", actor, user.getEmail(), user.isPendingApproval() ? "Sign-up rejected" : "");
    }

    /** The name of the user with this id, for emails ("Ann invited you"), else {@code fallback}. */
    @Transactional(readOnly = true)
    public String nameOf(Long id, String fallback) {
        return users.findById(id).map(User::getName).orElse(fallback);
    }

    private static final String PASSWORD_MISMATCH = "The password and confirm-password must match.";

    private Set<Role> resolveRoles(List<String> names) {
        Set<Role> resolved = new LinkedHashSet<>();
        for (String name : names) {
            resolved.add(roles.findByName(name)
                    .orElseThrow(() -> new ValidationException("roles", "There is no role named `" + name + "`.")));
        }
        return resolved;
    }
}
