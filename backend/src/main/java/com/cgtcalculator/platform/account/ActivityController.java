package com.cgtcalculator.platform.account;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The activity log for admins, newest first; {@code type} filters by the start of the action ("login", "user"). */
@RestController
@RequestMapping("/api/activity")
public class ActivityController {

    public record EntryDto(Long id, Instant at, String actor, String action, String target, String details, String ip) {
        static EntryDto of(ActivityEntry e) {
            return new EntryDto(e.getId(), e.getAt(), e.getActor(), e.getAction(), e.getTarget(), e.getDetails(), e.getIp());
        }
    }

    public record PageDto(List<EntryDto> content, int page, int size, long totalElements, int totalPages) {
    }

    private final ActivityRepository repository;

    public ActivityController(ActivityRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public PageDto index(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "25") int size,
                         @RequestParam(required = false) String type) {
        PageRequest request = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100));
        Page<ActivityEntry> entries = type == null || type.isBlank()
                ? repository.findAllByOrderByAtDescIdDesc(request)
                : repository.findByActionStartingWithOrderByAtDescIdDesc(type.trim(), request);
        return new PageDto(entries.getContent().stream().map(EntryDto::of).toList(), entries.getNumber(), entries.getSize(),
                entries.getTotalElements(), entries.getTotalPages());
    }
}
