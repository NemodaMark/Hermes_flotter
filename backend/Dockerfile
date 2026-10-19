FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY . .
RUN dotnet publish src/Hermes.Api/Hermes.Api.csproj -c Release -o /app --no-self-contained

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /app/keys && chown $APP_UID:$APP_UID /app/keys
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Hermes.Api.dll"]
