package com.cgtcalculator.platform.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.cgtcalculator.platform.monitoring.RequestLogFilter;

/**
 * Maps exceptions to JSON error responses ({@code {message, errors}} like Laravel's validation errors). Apps map
 * their own exceptions in advice ordered before this one, whose catch-all would otherwise answer them.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    public static class BadRequestException extends RuntimeException {
        public BadRequestException(String message) {
            super(message);
        }
    }

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) {
            super(message);
        }
    }

    /** Too many attempts (HTTP 429): try again after {@code retryAfterSeconds}. */
    public static class TooManyRequestsException extends RuntimeException {
        private final long retryAfterSeconds;

        public TooManyRequestsException(String message, long retryAfterSeconds) {
            super(message);
            this.retryAfterSeconds = retryAfterSeconds;
        }

        public long getRetryAfterSeconds() {
            return retryAfterSeconds;
        }
    }

    /**
     * The body of every error response.
     *
     * @param errors the messages per field of a form that was refused (HTTP 422), like Laravel's validation errors
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ErrorBody(String message, Map<String, List<String>> errors) {
    }

    /** Validation errors (HTTP 422): one field's, or several fields' at once. */
    public static class ValidationException extends RuntimeException {
        private final String field;
        private final Map<String, List<String>> errors;

        public ValidationException(String field, String message) {
            this(message, Map.of(field, List.of(message)));
        }

        /** @param errors the messages per field, in order; the first is the summary */
        public ValidationException(String message, Map<String, List<String>> errors) {
            super(message);
            this.errors = Map.copyOf(errors);
            this.field = errors.keySet().iterator().next();
        }

        public String getField() {
            return field;
        }

        public Map<String, List<String>> getErrors() {
            return errors;
        }
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorBody> handleInvalid(MethodArgumentNotValidException e) {
        Map<String, List<String>> errors = new LinkedHashMap<>();
        e.getBindingResult().getFieldErrors().forEach(error ->
                errors.computeIfAbsent(error.getField(), k -> new ArrayList<>()).add(error.getDefaultMessage()));
        return body(HttpStatus.UNPROCESSABLE_CONTENT, "The given data was invalid.", errors);
    }

    @ExceptionHandler(ValidationException.class)
    public ResponseEntity<ErrorBody> handleValidation(ValidationException e) {
        return body(HttpStatus.UNPROCESSABLE_CONTENT, e.getMessage(), e.getErrors());
    }

    @ExceptionHandler({BadRequestException.class, MissingServletRequestParameterException.class})
    public ResponseEntity<ErrorBody> handleBadRequest(Exception e) {
        return body(HttpStatus.BAD_REQUEST, e.getMessage(), null);
    }

    /** A body that isn't the JSON expected, or a parameter of the wrong type: the client's mistake, not ours. */
    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ErrorBody> handleUnreadable(Exception e) {
        return body(HttpStatus.BAD_REQUEST, "The request is malformed.", null);
    }

    @ExceptionHandler(TooManyRequestsException.class)
    public ResponseEntity<ErrorBody> handleTooMany(TooManyRequestsException e) {
        long seconds = e.getRetryAfterSeconds();
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(seconds))
                .body(new ErrorBody(e.getMessage() + " Please try again in " + duration(seconds) + ".", null));
    }

    /** "40 seconds", "3 minutes". */
    static String duration(long seconds) {
        if (seconds < 120) return seconds + (seconds == 1 ? " second" : " seconds");
        long minutes = (seconds + 59) / 60;
        return minutes + " minutes";
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ErrorBody> handleNotFound(RuntimeException e) {
        return body(HttpStatus.NOT_FOUND, e.getMessage(), null);
    }

    @ExceptionHandler({AccessDeniedException.class, AuthorizationDeniedException.class})
    public ResponseEntity<ErrorBody> handleAccessDenied(RuntimeException e) {
        return body(HttpStatus.FORBIDDEN, "This action is unauthorized.", null);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ErrorBody> handleResponseStatus(ResponseStatusException e) {
        HttpStatus status = HttpStatus.valueOf(e.getStatusCode().value());
        return body(status, e.getReason() != null ? e.getReason() : status.getReasonPhrase(), null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorBody> handleOther(Exception e) {
        if (e instanceof ErrorResponse errorResponse) {
            HttpStatus status = HttpStatus.valueOf(errorResponse.getStatusCode().value());
            return body(status, status.getReasonPhrase(), null);
        }
        log.error("Unhandled error", e);
        // the reference finds this request in the logs and in Sentry
        String reference = MDC.get(RequestLogFilter.MDC_KEY);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, reference == null ? "Server error" : "Server error (reference " + reference + ")", null);
    }

    private static ResponseEntity<ErrorBody> body(HttpStatus status, String message, Map<String, List<String>> errors) {
        return ResponseEntity.status(status).body(new ErrorBody(message, errors));
    }
}
