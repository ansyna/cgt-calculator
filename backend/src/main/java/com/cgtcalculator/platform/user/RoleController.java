package com.cgtcalculator.platform.user;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
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

import com.cgtcalculator.platform.user.UserController.PageDto;
import com.cgtcalculator.platform.account.ActivityService;
import com.cgtcalculator.platform.web.ApiExceptionHandler.BadRequestException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.NotFoundException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

/** Port of RoleController (Role Management) plus the permission list. */
@RestController
@RequestMapping("/api")
@Transactional
public class RoleController {

    public record PermissionDto(Long id, String name) {
        static PermissionDto of(Permission permission) {
            return new PermissionDto(permission.getId(), permission.getName());
        }
    }

    public record RoleDto(Long id, String name, List<PermissionDto> permissions) {
        static RoleDto of(Role role) {
            return new RoleDto(role.getId(), role.getName(),
                    role.getPermissions().stream().map(PermissionDto::of).toList());
        }
    }

    public record RoleRequest(
            @NotBlank @Size(max = 255) String name,
            @NotEmpty(message = "The permission field is required.") @Size(max = 500) List<Long> permission) {
    }

    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final UserRepository userRepository;

    private final ActivityService activity;

    public RoleController(RoleRepository roleRepository, PermissionRepository permissionRepository,
                          UserRepository userRepository, ActivityService activity) {
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.userRepository = userRepository;
        this.activity = activity;
    }

    private static String actor(Jwt jwt) {
        return jwt == null ? "" : jwt.getClaimAsString("email");
    }

    private static String names(Set<Permission> permissions) {
        return permissions.stream().map(Permission::getName).sorted().collect(java.util.stream.Collectors.joining(", "));
    }

    @GetMapping("/roles")
    @PreAuthorize("hasAuthority('role-list')")
    @Transactional(readOnly = true)
    public PageDto<RoleDto> index(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "5") int size) {
        PageRequest request = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100), Sort.by("id").descending());
        return PageDto.of(roleRepository.findAll(request).map(RoleDto::of));
    }

    @GetMapping("/roles/{id}")
    @PreAuthorize("hasAuthority('role-list')")
    @Transactional(readOnly = true)
    public RoleDto show(@PathVariable Long id) {
        return RoleDto.of(find(id));
    }

    @GetMapping("/permissions")
    @PreAuthorize("hasAuthority('role-list')")
    @Transactional(readOnly = true)
    public List<PermissionDto> permissions() {
        return permissionRepository.findAll(Sort.by("id")).stream().map(PermissionDto::of).toList();
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('role-create')")
    public RoleDto store(@Valid @RequestBody RoleRequest request, @AuthenticationPrincipal Jwt jwt) {
        String name = request.name().trim();
        if (roleRepository.existsByName(name)) {
            throw new ValidationException("name", "The name has already been taken.");
        }
        Role role = new Role(name);
        role.setPermissions(resolvePermissions(request.permission()));
        activity.record("role.created", actor(jwt), name, "Permissions: " + names(role.getPermissions()));
        return RoleDto.of(roleRepository.save(role));
    }

    @PutMapping("/roles/{id}")
    @PreAuthorize("hasAuthority('role-edit')")
    public RoleDto update(@PathVariable Long id, @Valid @RequestBody RoleRequest request, @AuthenticationPrincipal Jwt jwt) {
        Role role = find(id);
        String name = request.name().trim();
        roleRepository.findByName(name).filter(other -> !other.getId().equals(id)).ifPresent(other -> {
            throw new ValidationException("name", "The name has already been taken.");
        });
        if (Role.ADMIN.equals(role.getName()) && !Role.ADMIN.equals(name)) {
            throw new BadRequestException("The admin role cannot be renamed.");
        }
        Set<Permission> permissions = resolvePermissions(request.permission());
        if (Role.ADMIN.equals(role.getName()) && permissions.size() < permissionRepository.count()) {
            // removing e.g. user-edit from admin would leave nobody able to manage users
            throw new ValidationException("permission", "The admin role must keep all permissions.");
        }
        String oldName = role.getName();
        role.setName(name);
        role.setPermissions(permissions);
        activity.record("role.updated", actor(jwt), name,
                (oldName.equals(name) ? "" : "Renamed from " + oldName + "; ") + "permissions: " + names(permissions));
        return RoleDto.of(role);
    }

    @DeleteMapping("/roles/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('role-delete')")
    public void destroy(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        Role role = find(id);
        if (Role.ADMIN.equals(role.getName())) {
            throw new BadRequestException("The admin role cannot be deleted.");
        }
        for (User user : userRepository.findByRolesContaining(role)) {
            user.getRoles().remove(role);
        }
        roleRepository.delete(role);
        activity.record("role.deleted", actor(jwt), role.getName(), "");
    }

    private Set<Permission> resolvePermissions(List<Long> ids) {
        Set<Permission> permissions = new LinkedHashSet<>();
        for (Long permissionId : ids) {
            permissions.add(permissionRepository.findById(permissionId)
                    .orElseThrow(() -> new ValidationException("permission", "Unknown permission " + permissionId)));
        }
        return permissions;
    }

    private Role find(Long id) {
        return roleRepository.findById(id).orElseThrow(() -> new NotFoundException("Role not found"));
    }
}
