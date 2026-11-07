package com.cgtcalculator.platform.user;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    List<User> findByRolesContaining(Role role);

    /** Sign-ups waiting for an admin to give them a role, newest first. */
    @Query("select u from User u where u.roles is empty and (u.invitationPending is null or u.invitationPending = false) "
            + "order by u.createdAt desc")
    List<User> findPendingApproval();
}
