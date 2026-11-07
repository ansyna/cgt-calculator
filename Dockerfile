# One image with the React frontend served by the Spring Boot backend.
# Build: docker build -t cgt-calculator .    Run: see docker-compose.yml

# Node only builds the frontend (it doesn't run in the deployed image); at least 22.23.4, October 2026's security release
FROM node:22.23.4-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /app/backend
COPY backend/pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY backend/src ./src
COPY --from=frontend /app/frontend/dist ./src/main/resources/static
# tests run in CI and locally; the image build only packages
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
# Alpine's security fixes released since the base image was built (the image scan in CI fails on fixable ones)
RUN apk upgrade --no-cache \
    && addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown app:app /app/data
# eMudhra's emSign roots out of Java's own trust store (the one its HTTPS calls use, not Alpine's): private keys of
# intermediate certificates under them were compromised (October 2026), and Java 21.0.12.1 still trusts them. None of
# the services called (the ECB, Sentry, mail) use them. The build fails should any be left.
RUN for alias in $(keytool -list -v -cacerts -storepass changeit | sed -n "s/^Alias name: //p" | grep -i emsign | tr " " "~"); do \
        keytool -delete -cacerts -storepass changeit -alias "$(echo "$alias" | tr "~" " ")"; \
    done \
    && ! keytool -list -cacerts -storepass changeit | grep -qi emsign
WORKDIR /app
COPY --from=backend /app/backend/target/cgt-calculator-1.0.0.jar app.jar
USER app
# Sized for small instances (e.g. 512 MB): heap as a share of the container's memory, a lean GC,
# and quick JIT, so the app starts fast and stays within the limit.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=65 -XX:+UseSerialGC -Xss512k -XX:TieredStopAtLevel=1 -XX:ReservedCodeCacheSize=48m -XX:MaxMetaspaceSize=128m"
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
