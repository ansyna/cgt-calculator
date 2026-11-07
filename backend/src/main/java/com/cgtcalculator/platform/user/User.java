package com.cgtcalculator.platform.user;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.stream.Stream;

import org.hibernate.annotations.BatchSize;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String password;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "model_has_roles",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    @OrderBy("id")
    // a page of users loads its roles (and the roles their permissions) in one query, not one per user
    @BatchSize(size = 100)
    private Set<Role> roles = new LinkedHashSet<>();

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    // the columns below are nullable so they can be added to an existing table

    /** When the user proved the address by following the emailed link. */
    @Column(name = "email_verified_at")
    private Instant emailVerifiedAt;

    /** Set for sign-ups while email is set up; older accounts and admin-created ones count as verified. */
    @Column(name = "verification_required")
    private Boolean verificationRequired;

    /** Invited by an admin and not yet accepted: no usable password. */
    @Column(name = "invitation_pending")
    private Boolean invitationPending;

    protected User() {
    }

    public User(String name, String email, String password) {
        this.name = name;
        this.email = email;
        this.password = password;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public Set<Role> getRoles() {
        return roles;
    }

    public void setRoles(Set<Role> roles) {
        this.roles = roles;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getEmailVerifiedAt() {
        return emailVerifiedAt;
    }

    public void setEmailVerifiedAt(Instant emailVerifiedAt) {
        this.emailVerifiedAt = emailVerifiedAt;
    }

    public boolean isVerificationRequired() {
        return Boolean.TRUE.equals(verificationRequired);
    }

    public void setVerificationRequired(boolean verificationRequired) {
        this.verificationRequired = verificationRequired;
    }

    /** Verified, or never asked to verify. */
    public boolean isEmailVerified() {
        return emailVerifiedAt != null || !isVerificationRequired();
    }

    public boolean isInvitationPending() {
        return Boolean.TRUE.equals(invitationPending);
    }

    public void setInvitationPending(boolean invitationPending) {
        this.invitationPending = invitationPending;
    }

    /** Signed up but not given a role yet. */
    public boolean isPendingApproval() {
        return roles.isEmpty() && !isInvitationPending();
    }

    /** Spring Security authorities: ROLE_&lt;role&gt; for each role plus every permission name. */
    public Stream<String> authorityNames() {
        return Stream.concat(
                roles.stream().map(role -> "ROLE_" + role.getName()),
                roles.stream().flatMap(role -> role.getPermissions().stream()).map(Permission::getName)).distinct();
    }

    public boolean hasRole(String roleName) {
        return roles.stream().anyMatch(role -> role.getName().equals(roleName));
    }
}
