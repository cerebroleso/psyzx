using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Services;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));

builder.Services.AddHttpClient();

// --- REGISTRAZIONE SERVIZI ---
builder.Services.AddScoped<LibraryScanner>();
builder.Services.AddSingleton<LyricsDownloader>(); // AGGIUNTO QUI!

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options =>
{
    options.IncludeScopes = false;
    options.TimestampFormat = "[HH:mm:ss] ";
    options.SingleLine = true;
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers().RequireAuthorization();

app.MapGet("/api/health", () =>
{
    bool ffmpegOk = false;
    try
    {
        var process = Process.Start(new ProcessStartInfo { FileName = "ffmpeg", Arguments = "-version", RedirectStandardOutput = true, UseShellExecute = false });
        process?.WaitForExit();
        ffmpegOk = process?.ExitCode == 0;
    }
    catch { }
    return new { status = "ok", os = "linux", ffmpegInstalled = ffmpegOk };
}).AllowAnonymous();

_ = Task.Run(async () =>
{
    using var scope = app.Services.CreateScope();
    var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
    await scanner.ScanAsync();
});

app.UseCors(policy => policy
    .AllowAnyOrigin()
    .AllowAnyMethod()
    .AllowAnyHeader()
    .WithExposedHeaders("Content-Range", "Content-Length", "Accept-Ranges"));

app.Run();