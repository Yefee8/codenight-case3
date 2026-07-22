FROM maven:3.9.11-eclipse-temurin-21-alpine AS build
WORKDIR /workspace
COPY pom.xml ./
RUN mvn -B -ntp dependency:go-offline
COPY src ./src
RUN mvn -B -ntp package -DskipTests

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache wget && addgroup -S fraudcell && adduser -S -G fraudcell -u 10001 fraudcell
WORKDIR /app
COPY --from=build --chown=fraudcell:fraudcell /workspace/target/gamification-service-1.0.0.jar /app/app.jar
USER 10001:10001
EXPOSE 8083
ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-Djava.security.egd=file:/dev/urandom","-jar","/app/app.jar"]
