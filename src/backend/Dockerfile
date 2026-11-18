FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["Jdisc.sln", "./"]
COPY ["src/Jdisc.Domain/Jdisc.Domain.csproj", "src/Jdisc.Domain/"]
COPY ["src/Jdisc.Application/Jdisc.Application.csproj", "src/Jdisc.Application/"]
COPY ["src/Jdisc.Infrastructure/Jdisc.Infrastructure.csproj", "src/Jdisc.Infrastructure/"]
COPY ["src/Jdisc.Presentation/Jdisc.Presentation.csproj", "src/Jdisc.Presentation/"]
COPY ["tests/Jdisc.Domain.UnitTests/Jdisc.Domain.UnitTests.csproj", "tests/Jdisc.Domain.UnitTests/"]
COPY ["tests/Jdisc.Application.UnitTests/Jdisc.Application.UnitTests.csproj", "tests/Jdisc.Application.UnitTests/"]

RUN dotnet restore "src/Jdisc.Presentation/Jdisc.Presentation.csproj"

COPY . .
WORKDIR "/src/src/Jdisc.Presentation"
RUN dotnet publish "Jdisc.Presentation.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
EXPOSE 8080
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Jdisc.Presentation.dll"]
