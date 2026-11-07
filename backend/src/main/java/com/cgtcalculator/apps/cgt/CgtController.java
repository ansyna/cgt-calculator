package com.cgtcalculator.apps.cgt;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
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

import com.cgtcalculator.apps.cgt.CgtCalculator.Kind;
import com.cgtcalculator.platform.ledger.ShareTrade;
import com.cgtcalculator.platform.ledger.ShareTrade.Source;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** The CGT calculator: the signed-in user's share purchases and sales, and their CGT by tax year. */
@RestController
@RequestMapping("/api/cgt")
public class CgtController {

    /** The most rows one import takes (its body may be up to 1 MB: app.request-size in application.yml). */
    static final int MAX_IMPORT = 2000;

    /**
     * A purchase or sale.
     *
     * @param price   per share, in {@code currency}
     * @param fees    broker fees and other costs of the trade, in {@code currency}
     * @param eurRate units of {@code currency} per euro on the day; left out, the ECB's reference rate of the day
     * @param source  how shares were acquired (purchases only): bought, RSU or ESPP
     */
    public record CgtTransactionRequest(
            @NotNull Kind kind,
            @NotNull @PastOrPresent(message = "The date can't be in the future.") LocalDate date,
            @NotBlank @Size(max = 20) @Pattern(regexp = "[A-Za-z0-9.\\-]+", message = "Use the ticker, e.g. AAPL or BRK.B.") String symbol,
            @NotNull @DecimalMin(value = "0", inclusive = false, message = "The number of shares must be more than 0.")
            @Digits(integer = 14, fraction = 6) BigDecimal quantity,
            @NotNull @DecimalMin(value = "0", message = "The price can't be negative.") @Digits(integer = 14, fraction = 6) BigDecimal price,
            @NotBlank @Pattern(regexp = "[A-Za-z]{3}", message = "Use the three-letter currency code, e.g. EUR or USD.") String currency,
            @Nullable @DecimalMin(value = "0", message = "Fees can't be negative.") @Digits(integer = 18, fraction = 2) BigDecimal fees,
            @Nullable @DecimalMin(value = "0", inclusive = false, message = "The rate must be more than 0.")
            @DecimalMax(value = "1000000") @Digits(integer = 12, fraction = 8) BigDecimal eurRate,
            @Nullable Source source,
            @Nullable @Size(max = 200) String note) {

        CgtService.Fields fields() {
            return new CgtService.Fields(kind, date, symbol, quantity, price, currency, fees, eurRate, source, note);
        }
    }

    /**
     * A purchase or sale, whichever app it was entered in.
     *
     * @param name      the company's name, when known
     * @param eurRate     the rate it was entered with (units of the currency per euro): the one its euro figures are worked out at
     * @param ecbRate     the ECB's reference rate of its day; none until it's looked up
     * @param ecbRateDate the day {@code ecbRate} is the ECB's rate of: the trade's, or the last before it (a weekend, a holiday)
     * @param eurValue    shares × price in euro, before fees
     * @param enteredIn   the app it was entered in (any app may change it)
     */
    public record CgtTransactionDto(Long id, Kind kind, LocalDate date, String symbol, @Nullable String name, BigDecimal quantity, BigDecimal price,
                                    String currency, BigDecimal fees, BigDecimal eurRate, @Nullable BigDecimal ecbRate,
                                    @Nullable LocalDate ecbRateDate, @Nullable Source source, @Nullable String note, BigDecimal eurValue,
                                    ShareTrade.App enteredIn) {

        static CgtTransactionDto of(ShareTrade t) {
            BigDecimal rate = t.getEurRate() == null ? BigDecimal.ONE : t.getEurRate();
            return new CgtTransactionDto(t.getId(), t.getKind() == ShareTrade.Kind.BUY ? Kind.BUY : Kind.SELL, t.getDate(), t.getSymbol(),
                    t.getName(), t.getQuantity().stripTrailingZeros(), ShareTrade.shown(t.price(), 6), t.getCurrency(),
                    t.getFees().setScale(2, RoundingMode.HALF_UP), ShareTrade.shown(rate, 8),
                    t.getEcbRate() == null ? null : ShareTrade.shown(t.getEcbRate(), 8), t.getEcbRateDate(), t.getSource(),
                    t.getNote(), CgtService.eurValue(t), t.getEnteredIn());
        }
    }

    /** Rows to record at once, e.g. from a broker's statement: all of them or none. */
    public record CgtImportRequest(@NotNull @Size(min = 1, max = MAX_IMPORT) List<@Valid @NotNull CgtTransactionRequest> transactions) {
    }

    /** @param imported how many transactions were recorded */
    public record CgtImportResult(int imported) {
    }

    /** @param deleted how many transactions were deleted */
    public record CgtDeleteResult(int deleted) {
    }

    /** @param lossesBefore unused losses from years before the first sale recorded here */
    public record CgtSettingsRequest(@NotNull @DecimalMin("0") @Digits(integer = 16, fraction = 2) BigDecimal lossesBefore) {
    }

    private final CgtService cgt;

    public CgtController(CgtService cgt) {
        this.cgt = cgt;
    }

    private static Long user(Jwt jwt) {
        return Long.valueOf(jwt.getSubject());
    }

    /** The purchases and sales the CGT counts, by day: the user's own shares', whichever app they were entered in. */
    @GetMapping("/transactions")
    public List<CgtTransactionDto> transactions(@AuthenticationPrincipal Jwt jwt) {
        return cgt.list(user(jwt)).stream().map(CgtTransactionDto::of).toList();
    }

    @PostMapping("/transactions")
    @ResponseStatus(HttpStatus.CREATED)
    public CgtTransactionDto create(@Valid @RequestBody CgtTransactionRequest request, @AuthenticationPrincipal Jwt jwt) {
        return CgtTransactionDto.of(cgt.create(user(jwt), request.fields()));
    }

    @PostMapping("/transactions/import")
    @ResponseStatus(HttpStatus.CREATED)
    public CgtImportResult importAll(@Valid @RequestBody CgtImportRequest request, @AuthenticationPrincipal Jwt jwt) {
        return new CgtImportResult(cgt.importAll(user(jwt), request.transactions().stream().map(CgtTransactionRequest::fields).toList()).size());
    }

    @PutMapping("/transactions/{id}")
    public CgtTransactionDto update(@PathVariable Long id, @Valid @RequestBody CgtTransactionRequest request, @AuthenticationPrincipal Jwt jwt) {
        return CgtTransactionDto.of(cgt.update(user(jwt), id, request.fields()));
    }

    /** Deletes the user's transactions from one day to another (both included), e.g. to import that period again. */
    @DeleteMapping("/transactions")
    public CgtDeleteResult deletePeriod(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                        @AuthenticationPrincipal Jwt jwt) {
        return new CgtDeleteResult(cgt.deletePeriod(user(jwt), from, to));
    }

    @DeleteMapping("/transactions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id, @AuthenticationPrincipal Jwt jwt) {
        cgt.delete(user(jwt), id);
    }

    /**
     * The CGT of a tax year (by default the latest with sales), the shares held and the settings; each trade at the rate
     * it was entered with, or ({@code rates=ECB}) at the ECB's of its day, the trades as they are.
     */
    @GetMapping("/overview")
    public CgtService.CgtOverview overview(@RequestParam(required = false) @Nullable @Min(2000) @Max(2100) Integer year,
                                       @RequestParam(defaultValue = "ENTERED") CgtService.Rates rates,
                                       @AuthenticationPrincipal Jwt jwt) {
        return cgt.overview(user(jwt), year, rates);
    }

    @PutMapping("/settings")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void settings(@Valid @RequestBody CgtSettingsRequest request, @AuthenticationPrincipal Jwt jwt) {
        cgt.setLossesBefore(user(jwt), request.lossesBefore());
    }
}
