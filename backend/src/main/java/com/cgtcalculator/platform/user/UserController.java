package com.cgtcalculator.platform.user;

import java.util.List;

import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.jspecify.annotations.Nullable;

import com.cgtcalculator.platform.account.AccountEmails;
import com.cgtcalculator.platform.account.ActivityService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

/** Port of UserController (Users Management). */
@RestController
@RequestMapping("/api/users")
public class UserController {

    /**
     * @param emailVerified    false while a sign-up hasn't confirmed its address
     * @param invitationPending invited and not accepted yet
     */
    public record UserDto(Long id, String name, String email, List<String> roles, boolean emailVerified,
                          boolean invitationPending, java.time.Instant createdAt) {
        static UserDto of(User user) {
            return new UserDto(user.getId(), user.getName(), user.getEmail(),
                    user.getRoles().stream().map(Role::getName).toList(), user.isEmailVerified(), user.isInvitationPending(),
                    user.getCreatedAt());
        }
    }

    public record InviteRequest(@NotBlank @Email @Size(max = 255) String email, @Size(max = 255) String name,
                                @NotEmpty(message = "Choose at least one role.") @Size(max = 50) List<String> roles) {
    }

    public record ApproveRequest(@Size(max = 50) List<String> roles) {
    }

    /** A link to pass on; {@code emailed} says whether the app already sent it. */
    public record LinkDto(UserDto user, String path, @Nullable String url, boolean emailed) {
    }

    public record PageDto<T>(List<T> content, int page, int size, long totalElements, int totalPages) {
        static <T> PageDto<T> of(Page<T> page) {
            return new PageDto<>(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(),
                    page.getTotalPages());
        }
    }

    public record UserRequest(
            @NotBlank @Size(max = 255) String name,
            @NotBlank @Email @Size(max = 255) String email,
            @Size(max = 255) String password,
            @Size(max = 255) String confirmPassword,
            @NotEmpty(message = "The roles field is required.") @Size(max = 50) List<String> roles) {
    }

    private final UserService users;
    private final AccountEmails emails;
    private final ActivityService activity;

    public UserController(UserService users, AccountEmails emails, ActivityService activity) {
        this.users = users;
        this.emails = emails;
        this.activity = activity;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('user-list')")
    public PageDto<UserDto> index(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "5") int size) {
        return PageDto.of(users.page(page, size).map(UserDto::of));
    }

    /** Sign-ups waiting for a role. */
    @GetMapping("/pending")
    @PreAuthorize("hasAuthority('user-list')")
    public List<UserDto> pending() {
        return users.pendingApproval().stream().map(UserDto::of).toList();
    }

    /** Gives a sign-up access (the investor role unless other roles are given) and tells them by email. */
    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('user-edit')")
    public UserDto approve(@PathVariable Long id, @Valid @RequestBody(required = false) ApproveRequest request,
                           @AuthenticationPrincipal Jwt jwt) {
        return UserDto.of(users.approve(id, request == null ? null : request.roles(), actor(jwt)));
    }

    /**
     * Invites someone by email: the account is created with the chosen roles and they pick their own password
     * through the link. Inviting a pending invitee again sends a new link. The email goes out once the account is
     * saved, so a slow mail server doesn't hold a database connection.
     */
    @PostMapping("/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('user-create')")
    public LinkDto invite(@Valid @RequestBody InviteRequest request, @AuthenticationPrincipal Jwt jwt) {
        User user = users.invite(request.email(), request.name(), request.roles());
        String inviter = actor(jwt);
        AccountEmails.Link link = emails.invitation(user, users.nameOf(Long.valueOf(jwt.getSubject()), inviter));
        activity.record("invitation.sent", inviter, user.getEmail(),
                (link.emailed() ? "Emailed" : "Link created to share") + "; roles: " + String.join(", ", request.roles()));
        return new LinkDto(UserDto.of(user), link.path(), link.url(), link.emailed());
    }

    /** A password reset link for the user, emailed when possible and returned to copy. */
    @PostMapping("/{id}/password-reset")
    @PreAuthorize("hasAuthority('user-edit')")
    public LinkDto passwordResetLink(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        User user = users.resettable(id);
        AccountEmails.Link link = emails.passwordReset(user, AccountEmails.Delivery.NOW);
        activity.record("password.reset-link", actor(jwt), user.getEmail(), link.emailed() ? "Emailed" : "Link created to share");
        return new LinkDto(UserDto.of(user), link.path(), link.url(), link.emailed());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('user-list')")
    public UserDto show(@PathVariable Long id) {
        return UserDto.of(users.find(id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('user-create')")
    public UserDto store(@Valid @RequestBody UserRequest request, @AuthenticationPrincipal Jwt jwt) {
        return UserDto.of(users.create(fields(request), actor(jwt)));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('user-edit')")
    public UserDto update(@PathVariable Long id, @Valid @RequestBody UserRequest request, @AuthenticationPrincipal Jwt jwt) {
        return UserDto.of(users.update(id, fields(request), String.valueOf(id).equals(jwt.getSubject()), actor(jwt)));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('user-delete')")
    public void destroy(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        users.delete(id, String.valueOf(id).equals(jwt.getSubject()), actor(jwt));
    }

    private static UserService.UserFields fields(UserRequest request) {
        return new UserService.UserFields(request.name(), request.email(), request.password(), request.confirmPassword(),
                request.roles());
    }

    private static String actor(Jwt jwt) {
        return jwt == null ? "" : jwt.getClaimAsString("email");
    }
}
