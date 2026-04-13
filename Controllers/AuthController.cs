using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace psyzx.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;

    public AuthController(AppDbContext db)
    {
        _db = db;
    }

    private static string HashString(string input)
    {
        if (string.IsNullOrEmpty(input)) return string.Empty;
        
        using var sha256 = SHA256.Create();
        var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
        return Convert.ToBase64String(bytes);
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] AuthRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "Username and password are required." });
        }

        if (await _db.Users.AnyAsync(u => u.Username == request.Username))
        {
            return Conflict(new { message = "Username already exists." });
        }

        var user = new User 
        { 
            Username = request.Username, 
            PasswordHash = HashString(request.Password),
            Role = await _db.Users.AnyAsync() ? "User" : "Admin"
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok();
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] AuthRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { message = "Username and password are required." });
        }

        var hash = HashString(request.Password);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == request.Username && u.PasswordHash == hash);

        if (user != null)
        {
            // CRITICAL FIX: The missing claims have been restored!
            var claims = new List<Claim> 
            { 
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Role, user.Role ?? "User")
            };
            
            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
            
            return Ok(new { id = user.Id, username = user.Username, role = user.Role });
        }
        
        return Unauthorized(new { message = "Invalid credentials." });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok();
    }

    [HttpGet("check")]
    public async Task<IActionResult> Check()
    {
        if (User.Identity?.IsAuthenticated == true) 
        {
            var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (int.TryParse(userIdStr, out int userId))
            {
                var user = await _db.Users.FindAsync(userId);
                if (user != null)
                {
                    return Ok(new { id = user.Id, username = user.Username, role = user.Role });
                }
            }
        }
        return Unauthorized();
    }
}

// Added JSON property names to guarantee perfect mapping from your Svelte frontend
public class AuthRequest
{
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;
    
    [JsonPropertyName("password")]
    public string Password { get; set; } = string.Empty;
}