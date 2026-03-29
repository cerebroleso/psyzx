using Microsoft.EntityFrameworkCore;
using psyzx.Models;

namespace psyzx.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Artist> Artists { get; set; } = null!;
    public DbSet<Album> Albums { get; set; } = null!;
    public DbSet<Track> Tracks { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Artist>()
            .HasMany(a => a.Albums)
            .WithOne(al => al.Artist)
            .HasForeignKey(al => al.ArtistId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Album>()
            .HasMany(al => al.Tracks)
            .WithOne(t => t.Album)
            .HasForeignKey(t => t.AlbumId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}