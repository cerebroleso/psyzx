using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Services;
using psyzx.Hubs;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Diagnostics;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using MySqlConnector;

// ---------------------------------------------------------
// PSYZX ENGINE PRE-FLIGHT DIAGNOSTICS
// ---------------------------------------------------------
Console.WriteLine("=================================================");
Console.WriteLine("PSYZX CORE ENGINE: INITIALIZING SYSTEM RUNTIME");
Console.WriteLine($"Boot Time: {DateTime.Now}");
Console.WriteLine($"Runtime OS: {Environment.OSVersion}");
Console.WriteLine($"Container ID: {Environment.MachineName}");
Console.WriteLine($"Execution User: {Environment.UserName}");
Console.WriteLine($"Deployment Directory: {Directory.GetCurrentDirectory()}");
Console.WriteLine("=================================================");

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------
// STAGE 1: CONFIGURATION
// ---------------------------------------------------------
Console.WriteLine("\n[STAGE 1: CONFIGURATION]");
Console.WriteLine("[CONFIG] Loading config.ini from filesystem...");
builder.Configuration.AddIniFile("config.ini", optional: true, reloadOnChange: true);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrEmpty(connectionString))
{
    Console.WriteLine("[CONFIG] CRITICAL: DefaultConnection string is null/empty. System failure imminent.");
}
else
{
    Console.WriteLine("[CONFIG] Connection string successfully parsed.");
}

// ---------------------------------------------------------
// STAGE 2: SERVICE REGISTRATION
// ---------------------------------------------------------
Console.WriteLine("\n[STAGE 2: SERVICE REGISTRATION]");

Console.WriteLine("[SERVICE] Initializing Response Compression (Brotli/Gzip)...");
builder.Services.AddResponseCompression(options => {
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
});

Console.WriteLine("[SERVICE] Configuring MariaDB with Pomelo EF Core...");
builder.Services.AddDbContext<AppDbContext>(options =>
{
    // FIX: Hardcoding the version avoids the eager connection attempt during startup.
    // 11.4.0 is a stable baseline for modern MariaDB containers.
    var serverVersion = new MariaDbServerVersion(new Version(11, 4, 0));

    options.UseMySql(connectionString, serverVersion, mysqlOptions =>
    {
        // This handles transient failures once the app is running
        mysqlOptions.EnableRetryOnFailure(
            maxRetryCount: 15,
            maxRetryDelay: TimeSpan.FromSeconds(5),
            errorNumbersToAdd: null);
    });
});

Console.WriteLine("[SERVICE] Registering Manual MariaDB Health Probe...");
builder.Services.AddHealthChecks()
    .AddAsyncCheck("mariadb_check", async () => 
    {
        try 
        {
            using var connection = new MySqlConnection(connectionString);
            await connection.OpenAsync();
            return HealthCheckResult.Healthy("MariaDB is responding to pings.");
        }
        catch (Exception ex) 
        {
            return HealthCheckResult.Unhealthy($"MariaDB Ping Failed: {ex.Message}");
        }
    });

builder.Services.AddHttpClient();
builder.Services.AddScoped<LibraryScanner>();

Console.WriteLine("[SERVICE] Configuring Authentication Middleware (Cookie-based)...");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "psyzx_auth";
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.Events.OnRedirectToLogin = context =>
        {
            Console.WriteLine($"[AUTH] Blocked Unauthorized Request: {context.Request.Path}");
            context.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSignalR();
builder.Services.AddSingleton<IUserIdProvider, UserIdProvider>();

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

builder.Logging.ClearProviders();
builder.Logging.AddConsole();

builder.Environment.WebRootPath = "wwwroot/psyzx-frontend/dist";

var app = builder.Build();

// ---------------------------------------------------------
// STAGE 3: DATABASE SCHEMA FORCING (THE BULLETPROOF LOOP)
// ---------------------------------------------------------
Console.WriteLine("\n[STAGE 3: DATABASE SCHEMA VERIFICATION]");
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    bool dbReady = false;
    int attempt = 1;
    int maxAttempts = 25; // Extended for headless cold starts

    while (!dbReady && attempt <= maxAttempts)
    {
        try
        {
            Console.WriteLine($"[DB] Initialization Attempt {attempt}/{maxAttempts}...");
            
            // This creates the database and all tables (including Users) 
            // defined in your DbContext if they do not exist.
            await context.Database.EnsureCreatedAsync();
            
            if (await context.Database.CanConnectAsync())
            {
                Console.WriteLine("[DB] Connection confirmed. Schema verified.");
                dbReady = true;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[DB] WARNING: MariaDB not ready yet. Sleeping 5s...");
            Console.WriteLine($"[DB] Diagnostics: {ex.Message}");
            attempt++;
            await Task.Delay(5000);
        }
    }

    if (!dbReady)
    {
        Console.WriteLine("[DB] FATAL: Engine could not reach MariaDB after exhaustive retries. System abort.");
        return; 
    }
}

// ---------------------------------------------------------
// STAGE 4: FILESYSTEM AND BINARY DIAGNOSTICS
// ---------------------------------------------------------
Console.WriteLine("\n[STAGE 4: FILESYSTEM DIAGNOSTICS]");
var musicPath = app.Configuration["MusicSettings:BasePath"] ?? "/app/Music";
musicPath = Path.GetFullPath(musicPath);

if (!Directory.Exists(musicPath))
{
    Console.WriteLine($"[FS] Directory {musicPath} missing. Creating now...");
    Directory.CreateDirectory(musicPath);
}
else
{
    Console.WriteLine($"[FS] Music Directory Found: {musicPath}");
}

string[] binaries = { "yt-dlp_linux", "spotdl_linux" };
foreach (var bin in binaries)
{
    var fullPath = Path.Combine(musicPath, bin);
    if (File.Exists(fullPath))
    {
        Console.WriteLine($"[FS] Binary {bin} located.");
    }
    else
    {
        Console.WriteLine($"[FS] CRITICAL: Binary {bin} is missing from {musicPath}");
    }
}

// ---------------------------------------------------------
// STAGE 5: PIPELINE CONFIGURATION
// ---------------------------------------------------------
Console.WriteLine("\n[STAGE 5: PIPELINE CONFIGURATION]");

app.UseCors(policy => policy
    .AllowAnyOrigin()
    .AllowAnyMethod()
    .AllowAnyHeader()
    .WithExposedHeaders("Content-Range", "Content-Length", "Accept-Ranges"));

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseResponseCompression();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// High-detail Request Logger
app.Use(async (context, next) =>
{
    var stopwatch = Stopwatch.StartNew();
    await next();
    stopwatch.Stop();
    Console.WriteLine($"[REQ] {context.Request.Method} {context.Request.Path} -> {context.Response.StatusCode} ({stopwatch.ElapsedMilliseconds}ms)");
});

// ---------------------------------------------------------
// STAGE 6: ENDPOINT MAPPING
// ---------------------------------------------------------
Console.WriteLine("[PIPELINE] Mapping API Endpoints and SignalR Hubs...");
app.MapControllers().RequireAuthorization();
app.MapHub<PlaybackHub>("/hubs/playback").RequireAuthorization();
app.MapHealthChecks("/health");

app.MapGet("/api/status", async (HealthCheckService healthService) =>
{
    var report = await healthService.CheckHealthAsync();
    var dbEntry = report.Entries.FirstOrDefault(e => e.Key == "mariadb_check");
    
    return new 
    { 
        status = report.Status.ToString(),
        db_connection = dbEntry.Value.Status.ToString(),
        db_detail = dbEntry.Value.Description,
        timestamp = DateTime.UtcNow
    };
}).AllowAnonymous();

app.MapFallbackToFile("index.html");

// ---------------------------------------------------------
// STAGE 7: BACKGROUND THREADS
// ---------------------------------------------------------
_ = Task.Run(async () =>
{
    Console.WriteLine("[BG] System background workers idling for 10s...");
    await Task.Delay(10000); 
    try 
    {
        using var scope = app.Services.CreateScope();
        var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
        Console.WriteLine("[BG] Commencing initial library synchronization...");
        await scanner.ScanAsync();
        Console.WriteLine("[BG] Synchronization cycle complete.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[BG] ERROR: Background scan failed: {ex.Message}");
    }
});

Console.WriteLine("\n[SYSTEM] Kestrel server is now listening for incoming connections.");
Console.WriteLine("=================================================\n");

app.Run();